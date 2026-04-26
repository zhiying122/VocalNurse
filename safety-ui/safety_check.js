/**
 * 防呆邏輯：劑量超標 + 過敏原連動 + 生命徵象異常
 */
let drugSafetyDB = null;

async function loadDrugDB() {
    const res = await fetch('drug_safety_db.json');
    drugSafetyDB = await res.json();
}

function checkSafety(brainOutput, patientRecords) {
    const alerts = [];
    if (!drugSafetyDB) return alerts;
    const records = patientRecords || [];

    if (brainOutput.medications) {
        for (const med of brainOutput.medications) {
            const da = checkDrugDosage(med);
            if (da) alerts.push(da);
            const aa = checkAllergy(med);
            if (aa) alerts.push(aa);
            const ddAlert = checkDailyDose(med, records, drugSafetyDB);
            if (ddAlert) alerts.push(ddAlert);
        }

        // Check drug interactions across all medications (once, not per-medication)
        const diAlerts = checkDrugInteractions(brainOutput.medications, drugSafetyDB);
        alerts.push(...diAlerts);
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
    if (dose == null || dose === '') return null;
    const n = parseFloat(String(dose).replace(/[^\d.\-]/g, ''));
    if (isNaN(n) || n < 0) return null;
    const u = (unit || '').toLowerCase().trim();
    if (u === 'g') return n * 1000;
    if (u === 'mcg' || u === 'μg') return n / 1000;
    return n; // default: mg
}

function formatDose(mg, targetUnit) {
    const u = (targetUnit || 'mg').toLowerCase().trim();
    if (u === 'g') return (mg / 1000).toString();
    if (u === 'mcg' || u === 'μg') return (mg * 1000).toString();
    return mg.toString();
}

function checkDailyDose(medication, patientRecords, drugDB) {
    const info = findDrug(medication.name);
    if (!info || !info.max_daily_dose_mg) return null;

    const currentDose = parseDose(medication.dose, medication.unit);
    if (currentDose === null) return null;

    // Sum today's doses for the same drug
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let dailyTotal = currentDose;

    if (patientRecords && patientRecords.length) {
        for (const record of patientRecords) {
            // Check if record is from today
            const recordDate = record.date || (record.time ? new Date().toISOString().slice(0, 10) : null);
            if (recordDate !== today) continue;

            if (record.medications) {
                for (const med of record.medications) {
                    // Match by name or aliases
                    const medName = med.name.toLowerCase();
                    const infoName = info.name.toLowerCase();
                    const infoAliases = info.aliases.map(a => a.toLowerCase());
                    if (medName === infoName || infoAliases.includes(medName)) {
                        const dose = parseDose(med.dose, med.unit);
                        if (dose !== null) dailyTotal += dose;
                    }
                }
            }
        }
    }

    if (dailyTotal > info.max_daily_dose_mg) {
        return {
            type: 'daily_dose_exceeded', severity: 'critical', item: medication.name,
            detected: `${dailyTotal} mg (今日累積)`,
            range: `每日上限 ${info.max_daily_dose_mg} mg`,
            message: `${medication.name} 今日累積劑量 ${dailyTotal}mg 已超過每日上限 ${info.max_daily_dose_mg}mg`
        };
    }

    if (dailyTotal >= info.max_daily_dose_mg * 0.8) {
        return {
            type: 'daily_dose_approaching', severity: 'warning', item: medication.name,
            detected: `${dailyTotal} mg (今日累積)`,
            range: `每日上限 ${info.max_daily_dose_mg} mg (80% = ${info.max_daily_dose_mg * 0.8} mg)`,
            message: `${medication.name} 今日累積劑量 ${dailyTotal}mg 已達每日上限的 80%，請注意`
        };
    }

    return null;
}

function resolveCanonicalName(name, drugDB) {
    if (!drugDB || !drugDB.drugs) return name.toLowerCase();
    const l = name.toLowerCase();
    const drug = drugDB.drugs.find(d => d.name.toLowerCase() === l || d.aliases.some(a => a.toLowerCase() === l));
    return drug ? drug.name.toLowerCase() : l;
}

function checkDrugInteractions(medications, drugDB) {
    const alerts = [];
    if (!medications || medications.length < 2 || !drugDB || !drugDB.interactions) return alerts;

    for (let i = 0; i < medications.length; i++) {
        for (let j = i + 1; j < medications.length; j++) {
            const med1 = medications[i];
            const med2 = medications[j];
            const canonical1 = resolveCanonicalName(med1.name, drugDB);
            const canonical2 = resolveCanonicalName(med2.name, drugDB);

            for (const interaction of drugDB.interactions) {
                const d1 = interaction.drug1.toLowerCase();
                const d2 = interaction.drug2.toLowerCase();

                if ((canonical1 === d1 && canonical2 === d2) ||
                    (canonical1 === d2 && canonical2 === d1)) {
                    alerts.push({
                        type: 'drug_interaction',
                        severity: interaction.severity,
                        item: `${med1.name} + ${med2.name}`,
                        detected: `${med1.name} 與 ${med2.name} 併用`,
                        range: '禁止或需謹慎併用',
                        message: interaction.description
                    });
                    break; // Only one interaction per pair
                }
            }
        }
    }
    return alerts;
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

    const rr = text.match(/RR\s*(\d+)/i);
    if (rr) {
        const val = parseInt(rr[1]);
        if (val > v.respiratory_rate.max || val < v.respiratory_rate.min) {
            alerts.push({
                type: 'vital_abnormal',
                severity: 'warning',
                item: '呼吸速率',
                detected: `${val} 次/分`,
                range: `${v.respiratory_rate.min}-${v.respiratory_rate.max} 次/分`,
                message: val > v.respiratory_rate.max ? v.respiratory_rate.warning_high : v.respiratory_rate.warning_low
            });
        }
    }

    return alerts;
}

// Only auto-load in browser environment (skip in Node.js/test environment)
if (typeof window !== 'undefined') {
    loadDrugDB();
}

// ES Module exports for testing (conditional to preserve browser compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDose,
    formatDose,
    findDrug,
    checkDrugDosage,
    checkDailyDose,
    checkDrugInteractions,
    checkAllergy,
    checkVitalSigns,
    checkSafety
  };
}
