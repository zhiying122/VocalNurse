/**
 * 防呆邏輯判定：Check_Safety()
 * 劑量超標 + 過敏原連動 + 生命徵象異常
 */

let drugSafetyDB = null;

// 病患過敏資料（實際會從後端取得）
const PATIENT_ALLERGIES = {
    'P001': ['Penicillin', 'Ampicillin'],
    'P002': ['Aspirin', 'NSAIDs'],
    'P003': [],
};

async function loadDrugDB() {
    const res = await fetch('drug_safety_db.json');
    drugSafetyDB = await res.json();
    console.log('[Safety] 藥品資料庫已載入', drugSafetyDB.drugs.length, '筆藥品');
}

/**
 * 主要防呆檢查
 */
function checkSafety(brainOutput) {
    const alerts = [];
    if (!drugSafetyDB) return alerts;

    // 1. 藥物劑量檢查
    if (brainOutput.medications) {
        for (const med of brainOutput.medications) {
            const doseAlert = checkDrugDosage(med);
            if (doseAlert) alerts.push(doseAlert);

            // 2. 過敏原連動檢查
            const allergyAlert = checkAllergy(med);
            if (allergyAlert) alerts.push(allergyAlert);
        }
    }

    // 3. 生命徵象檢查
    if (brainOutput.soap?.objective) {
        alerts.push(...checkVitalSigns(brainOutput.soap.objective));
    }

    return alerts;
}

/**
 * 過敏原連動檢查
 */
function checkAllergy(medication) {
    if (!currentPatient) return null;
    const allergies = PATIENT_ALLERGIES[currentPatient.id] || [];
    if (!allergies.length) return null;

    const medName = medication.name.toLowerCase();
    const nsaidDrugs = ['voltaren', 'voren', 'diclofenac', 'aspirin', 'ibuprofen'];

    for (const allergen of allergies) {
        const allergenLower = allergen.toLowerCase();

        // 直接匹配
        if (medName.includes(allergenLower) || allergenLower.includes(medName)) {
            return {
                type: 'allergy',
                severity: 'critical',
                item: medication.name,
                detected: `病患對 ${allergen} 過敏`,
                range: '禁止使用',
                message: `⚠️ 嚴重警告：病患對 ${allergen} 過敏，${medication.name} 屬於相關藥物，禁止使用！`,
            };
        }

        // NSAIDs 類別匹配
        if (allergenLower === 'nsaids' && nsaidDrugs.includes(medName)) {
            return {
                type: 'allergy',
                severity: 'critical',
                item: medication.name,
                detected: `病患對 NSAIDs 類藥物過敏`,
                range: '禁止使用',
                message: `⚠️ 嚴重警告：病患對 NSAIDs 過敏，${medication.name} 為 NSAIDs 類藥物，禁止使用！`,
            };
        }
    }
    return null;
}

function checkDrugDosage(medication) {
    const drugInfo = findDrug(medication.name);
    if (!drugInfo) return null;
    const dose = parseDose(medication.dose, medication.unit);
    if (dose === null) return null;
    if (dose > drugInfo.max_single_dose_mg) {
        return {
            type: 'dosage_exceeded', severity: 'critical',
            item: medication.name, detected: `${dose} mg`,
            range: `最大單次劑量 ${drugInfo.max_single_dose_mg} mg`,
            message: drugInfo.warning,
        };
    }
    return null;
}

function findDrug(name) {
    if (!drugSafetyDB) return null;
    const lower = name.toLowerCase();
    return drugSafetyDB.drugs.find(d =>
        d.name.toLowerCase() === lower ||
        d.aliases.some(a => a.toLowerCase() === lower)
    );
}

function parseDose(dose, unit) {
    if (!dose) return null;
    const num = parseFloat(String(dose).replace(/[^\d.]/g, ''));
    if (isNaN(num)) return null;
    if (unit && unit.toLowerCase() === 'g') return num * 1000;
    return num;
}

function checkVitalSigns(text) {
    const alerts = [];
    const v = drugSafetyDB.vital_signs;

    const bp = text.match(/BP\s*(\d+)\s*\/\s*(\d+)/i);
    if (bp) {
        const sys = parseInt(bp[1]);
        if (sys > v.systolic_bp.max) alerts.push({ type:'vital_abnormal', severity:'critical', item:'收縮壓', detected:`${sys} mmHg`, range:`${v.systolic_bp.min}-${v.systolic_bp.max} mmHg`, message:v.systolic_bp.warning_high });
        else if (sys < v.systolic_bp.min) alerts.push({ type:'vital_abnormal', severity:'critical', item:'收縮壓', detected:`${sys} mmHg`, range:`${v.systolic_bp.min}-${v.systolic_bp.max} mmHg`, message:v.systolic_bp.warning_low });
    }

    const hr = text.match(/HR\s*(\d+)/i);
    if (hr) {
        const val = parseInt(hr[1]);
        if (val > v.heart_rate.max || val < v.heart_rate.min) alerts.push({ type:'vital_abnormal', severity:'warning', item:'心跳', detected:`${val} bpm`, range:`${v.heart_rate.min}-${v.heart_rate.max} bpm`, message: val > v.heart_rate.max ? v.heart_rate.warning_high : v.heart_rate.warning_low });
    }

    const spo2 = text.match(/SpO2\s*(\d+)/i);
    if (spo2) {
        const val = parseInt(spo2[1]);
        if (val < v.spo2.min) alerts.push({ type:'vital_abnormal', severity:'critical', item:'血氧', detected:`${val}%`, range:`≥ ${v.spo2.min}%`, message:v.spo2.warning_low });
    }

    const bt = text.match(/BT\s*([\d.]+)/i);
    if (bt) {
        const val = parseFloat(bt[1]);
        if (val > v.body_temp.max || val < v.body_temp.min) alerts.push({ type:'vital_abnormal', severity:'warning', item:'體溫', detected:`${val}°C`, range:`${v.body_temp.min}-${v.body_temp.max}°C`, message: val > v.body_temp.max ? v.body_temp.warning_high : v.body_temp.warning_low });
    }

    return alerts;
}

loadDrugDB();
