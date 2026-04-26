/**
 * 防呆邏輯判定：Check_Safety()
 * 即時比對 Brain Layer 傳來的藥物數據與安全劑量資料庫
 */

let drugSafetyDB = null;

// 載入藥品安全劑量資料庫
async function loadDrugDB() {
    const res = await fetch('drug_safety_db.json');
    drugSafetyDB = await res.json();
    console.log('[Safety] 藥品資料庫已載入', drugSafetyDB.drugs.length, '筆藥品');
}

/**
 * 主要防呆檢查函式
 * @param {Object} brainOutput - 角色 B 回傳的完整 JSON
 * @returns {Array} alerts - 警示清單
 */
function checkSafety(brainOutput) {
    const alerts = [];

    if (!drugSafetyDB) {
        console.warn('[Safety] 資料庫尚未載入');
        return alerts;
    }

    // 檢查藥物劑量
    if (brainOutput.medications) {
        for (const med of brainOutput.medications) {
            const alert = checkDrugDosage(med);
            if (alert) alerts.push(alert);
        }
    }

    // 檢查生命徵象（從 SOAP Objective 欄位提取）
    if (brainOutput.soap && brainOutput.soap.objective) {
        const vitalAlerts = checkVitalSigns(brainOutput.soap.objective);
        alerts.push(...vitalAlerts);
    }

    return alerts;
}

/**
 * 檢查單一藥物劑量是否超標
 */
function checkDrugDosage(medication) {
    const drugInfo = findDrug(medication.name);
    if (!drugInfo) return null;

    const dose = parseDose(medication.dose, medication.unit);
    if (dose === null) return null;

    if (dose > drugInfo.max_single_dose_mg) {
        return {
            type: 'dosage_exceeded',
            severity: 'critical',
            item: medication.name,
            detected: `${dose} mg`,
            range: `最大單次劑量 ${drugInfo.max_single_dose_mg} mg`,
            message: drugInfo.warning,
        };
    }

    return null;
}

/**
 * 在資料庫中查找藥物（支援別名）
 */
function findDrug(name) {
    if (!drugSafetyDB) return null;
    const lower = name.toLowerCase();
    return drugSafetyDB.drugs.find(d =>
        d.name.toLowerCase() === lower ||
        d.aliases.some(a => a.toLowerCase() === lower)
    );
}

/**
 * 解析劑量數字
 */
function parseDose(dose, unit) {
    if (!dose) return null;
    const num = parseFloat(dose.replace(/[^\d.]/g, ''));
    if (isNaN(num)) return null;

    // 如果單位是 g，轉換為 mg
    if (unit && unit.toLowerCase() === 'g') return num * 1000;
    return num;
}

/**
 * 檢查生命徵象
 */
function checkVitalSigns(objectiveText) {
    const alerts = [];
    const vitals = drugSafetyDB.vital_signs;

    // BP 收縮壓/舒張壓
    const bpMatch = objectiveText.match(/BP\s*(\d+)\s*\/\s*(\d+)/i);
    if (bpMatch) {
        const systolic = parseInt(bpMatch[1]);
        const diastolic = parseInt(bpMatch[2]);

        if (systolic > vitals.systolic_bp.max) {
            alerts.push({
                type: 'vital_abnormal', severity: 'critical',
                item: '收縮壓 (SBP)', detected: `${systolic} mmHg`,
                range: `${vitals.systolic_bp.min}-${vitals.systolic_bp.max} mmHg`,
                message: vitals.systolic_bp.warning_high,
            });
        } else if (systolic < vitals.systolic_bp.min) {
            alerts.push({
                type: 'vital_abnormal', severity: 'critical',
                item: '收縮壓 (SBP)', detected: `${systolic} mmHg`,
                range: `${vitals.systolic_bp.min}-${vitals.systolic_bp.max} mmHg`,
                message: vitals.systolic_bp.warning_low,
            });
        }
    }

    // HR
    const hrMatch = objectiveText.match(/HR\s*(\d+)/i);
    if (hrMatch) {
        const hr = parseInt(hrMatch[1]);
        if (hr > vitals.heart_rate.max || hr < vitals.heart_rate.min) {
            alerts.push({
                type: 'vital_abnormal', severity: 'warning',
                item: '心跳 (HR)', detected: `${hr} bpm`,
                range: `${vitals.heart_rate.min}-${vitals.heart_rate.max} bpm`,
                message: hr > vitals.heart_rate.max ? vitals.heart_rate.warning_high : vitals.heart_rate.warning_low,
            });
        }
    }

    // SpO2
    const spo2Match = objectiveText.match(/SpO2\s*(\d+)/i);
    if (spo2Match) {
        const spo2 = parseInt(spo2Match[1]);
        if (spo2 < vitals.spo2.min) {
            alerts.push({
                type: 'vital_abnormal', severity: 'critical',
                item: '血氧 (SpO2)', detected: `${spo2}%`,
                range: `≥ ${vitals.spo2.min}%`,
                message: vitals.spo2.warning_low,
            });
        }
    }

    // BT 體溫
    const btMatch = objectiveText.match(/BT\s*([\d.]+)/i);
    if (btMatch) {
        const bt = parseFloat(btMatch[1]);
        if (bt > vitals.body_temp.max || bt < vitals.body_temp.min) {
            alerts.push({
                type: 'vital_abnormal', severity: 'warning',
                item: '體溫 (BT)', detected: `${bt}°C`,
                range: `${vitals.body_temp.min}-${vitals.body_temp.max}°C`,
                message: bt > vitals.body_temp.max ? vitals.body_temp.warning_high : vitals.body_temp.warning_low,
            });
        }
    }

    return alerts;
}

// 頁面載入時初始化
loadDrugDB();
