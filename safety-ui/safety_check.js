/**
 * 防呆邏輯：劑量超標 + 過敏原連動 + 生命徵象異常
 */
let drugSafetyDB = null;

async function loadDrugDB() {
    const res = await fetch('drug_safety_db.json');
    drugSafetyDB = await res.json();
}

function checkSafety(brainOutput) {
    const alerts = [];
    if (!drugSafetyDB) return alerts;

    if (brainOutput.medications) {
        for (const med of brainOutput.medications) {
            const da = checkDrugDosage(med);
            if (da) alerts.push(da);
            const aa = checkAllergy(med);
            if (aa) alerts.push(aa);
        }
    }

    if (brainOutput.soap?.objective) {
        alerts.push(...checkVitalSigns(brainOutput.soap.objective));
    }
    return alerts;
}

// 過敏原：從真實病患資料取得（不再寫死）
function checkAllergy(medication) {
    if (!currentPatient || !currentPatient.allergies?.length) return null;

    const medLower = medication.name.toLowerCase();
    const nsaids = ['voltaren', 'voren', 'diclofenac', 'aspirin', 'ibuprofen', 'ketorolac'];

    for (const allergen of currentPatient.allergies) {
        const aLower = allergen.toLowerCase();
        if (medLower.includes(aLower) || aLower.includes(medLower)) {
            return { type:'allergy', severity:'critical', item:medication.name,
                detected:`病患對 ${allergen} 過敏`, range:'禁止使用',
                message:`病患對 ${allergen} 過敏，${medication.name} 屬於相關藥物，禁止使用！` };
        }
        if (aLower === 'nsaids' && nsaids.includes(medLower)) {
            return { type:'allergy', severity:'critical', item:medication.name,
                detected:`病患對 NSAIDs 過敏`, range:'禁止使用',
                message:`病患對 NSAIDs 過敏，${medication.name} 為 NSAIDs 類藥物，禁止使用！` };
        }
        // Penicillin 類交叉過敏
        const penicillins = ['ampicillin', 'amoxicillin', 'penicillin', 'piperacillin'];
        if (aLower === 'penicillin' && penicillins.includes(medLower)) {
            return { type:'allergy', severity:'critical', item:medication.name,
                detected:`病患對 Penicillin 過敏`, range:'禁止使用',
                message:`病患對 Penicillin 過敏，${medication.name} 為同類抗生素，有交叉過敏風險！` };
        }
    }
    return null;
}

function checkDrugDosage(med) {
    const info = findDrug(med.name);
    if (!info) return null;
    const dose = parseDose(med.dose, med.unit);
    if (dose === null) return null;
    if (dose > info.max_single_dose_mg) {
        return { type:'dosage_exceeded', severity:'critical', item:med.name,
            detected:`${dose} mg`, range:`最大單次 ${info.max_single_dose_mg} mg`,
            message:info.warning };
    }
    return null;
}

function findDrug(name) {
    if (!drugSafetyDB) return null;
    const l = name.toLowerCase();
    return drugSafetyDB.drugs.find(d => d.name.toLowerCase()===l || d.aliases.some(a=>a.toLowerCase()===l));
}

function parseDose(dose, unit) {
    if (!dose) return null;
    const n = parseFloat(String(dose).replace(/[^\d.]/g,''));
    if (isNaN(n)) return null;
    if (unit && unit.toLowerCase()==='g') return n*1000;
    return n;
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
    if (hr) { const val=parseInt(hr[1]); if(val>v.heart_rate.max||val<v.heart_rate.min) alerts.push({ type:'vital_abnormal', severity:'warning', item:'心跳', detected:`${val} bpm`, range:`${v.heart_rate.min}-${v.heart_rate.max} bpm`, message:val>v.heart_rate.max?v.heart_rate.warning_high:v.heart_rate.warning_low }); }

    const spo2 = text.match(/SpO2\s*(\d+)/i);
    if (spo2) { const val=parseInt(spo2[1]); if(val<v.spo2.min) alerts.push({ type:'vital_abnormal', severity:'critical', item:'血氧', detected:`${val}%`, range:`≥ ${v.spo2.min}%`, message:v.spo2.warning_low }); }

    const bt = text.match(/BT\s*([\d.]+)/i);
    if (bt) { const val=parseFloat(bt[1]); if(val>v.body_temp.max||val<v.body_temp.min) alerts.push({ type:'vital_abnormal', severity:'warning', item:'體溫', detected:`${val}°C`, range:`${v.body_temp.min}-${v.body_temp.max}°C`, message:val>v.body_temp.max?v.body_temp.warning_high:v.body_temp.warning_low }); }

    return alerts;
}

loadDrugDB();
