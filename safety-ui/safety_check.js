/**
 * 防呆邏輯：劑量超標 + 過敏原連動 + 生命徵象異常 + 藥物交互作用
 *
 * 本模組是 VoiceNursy 安全防呆引擎的核心，負責：
 * 1. 藥物劑量檢查（單次劑量 + 每日累積劑量）
 * 2. 過敏原交叉比對（直接匹配 + NSAIDs 類別 + Penicillin 交叉過敏）
 * 3. 生命徵象異常偵測（BP/HR/SpO2/BT/RR，支援中英文格式）
 * 4. 藥物交互作用檢查（兩兩比對所有處方藥物）
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

        // 藥物交互作用檢查（所有藥物兩兩比對，只執行一次）
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

    // 加總今日同藥物的累積劑量
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let dailyTotal = currentDose;

    if (patientRecords && patientRecords.length) {
        for (const record of patientRecords) {
            const recordDate = record.date || (record.time ? new Date().toISOString().slice(0, 10) : null);
            if (recordDate !== today) continue;

            if (record.medications) {
                for (const med of record.medications) {
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
                    break; // 每對藥物只產生一個交互作用警示
                }
            }
        }
    }
    return alerts;
}

/**
 * 生命徵象異常檢查
 *
 * 支援多種格式的生命徵象輸入（中英文混合）：
 * - 血壓：BP 140/90, BP: 140/90, BP：140/90, BP140/90, BP 140/90 mmHg, 血壓 140/90
 * - 心率：HR 88, HR: 88, HR：88, 心率 88, 心跳 88
 * - 體溫：BT 38.5, BT: 38.5, 體溫 38.5, T 38.5
 * - 血氧：SpO2 95, SpO2: 95, 血氧 95
 * - 呼吸：RR 22, RR: 22, 呼吸 22
 */
function checkVitalSigns(text) {
    const alerts = [];
    if (!drugSafetyDB || !drugSafetyDB.vital_signs) return alerts;
    const v = drugSafetyDB.vital_signs;

    // ── 血壓（Blood Pressure）──
    // 支援格式：BP 140/90, BP: 140/90, BP：140/90, BP140/90, BP 140/90 mmHg, 血壓 140/90
    const bpPattern = /(?:BP|血壓)\s*[：:]?\s*(\d+)\s*\/\s*(\d+)(?:\s*mmHg)?/i;
    const bp = text.match(bpPattern);
    if (bp) {
        const sys = parseInt(bp[1]);
        const dia = parseInt(bp[2]);
        // 收縮壓檢查
        if (sys > v.systolic_bp.max) {
            alerts.push({ type:'vital_abnormal', severity:'critical', item:'收縮壓',
                detected:`${sys} mmHg`, range:`${v.systolic_bp.min}-${v.systolic_bp.max} mmHg`,
                message:v.systolic_bp.warning_high });
        } else if (sys < v.systolic_bp.min) {
            alerts.push({ type:'vital_abnormal', severity:'critical', item:'收縮壓',
                detected:`${sys} mmHg`, range:`${v.systolic_bp.min}-${v.systolic_bp.max} mmHg`,
                message:v.systolic_bp.warning_low });
        }
        // 舒張壓檢查
        if (dia > v.diastolic_bp.max) {
            alerts.push({ type:'vital_abnormal', severity:'warning', item:'舒張壓',
                detected:`${dia} mmHg`, range:`${v.diastolic_bp.min}-${v.diastolic_bp.max} mmHg`,
                message:v.diastolic_bp.warning_high });
        } else if (dia < v.diastolic_bp.min) {
            alerts.push({ type:'vital_abnormal', severity:'warning', item:'舒張壓',
                detected:`${dia} mmHg`, range:`${v.diastolic_bp.min}-${v.diastolic_bp.max} mmHg`,
                message:v.diastolic_bp.warning_low });
        }
    }

    // ── 心率（Heart Rate）──
    // 支援格式：HR 88, HR: 88, HR：88, 心率 88, 心跳 88
    const hrPattern = /(?:HR|心率|心跳)\s*[：:]?\s*(\d+)/i;
    const hr = text.match(hrPattern);
    if (hr) {
        const val = parseInt(hr[1]);
        if (val > v.heart_rate.max || val < v.heart_rate.min) {
            alerts.push({ type:'vital_abnormal', severity:'warning', item:'心跳',
                detected:`${val} bpm`, range:`${v.heart_rate.min}-${v.heart_rate.max} bpm`,
                message: val > v.heart_rate.max ? v.heart_rate.warning_high : v.heart_rate.warning_low });
        }
    }

    // ── 血氧（SpO2）──
    // 支援格式：SpO2 95, SpO2: 95, SpO2：95, 血氧 95
    const spo2Pattern = /(?:SpO2|血氧)\s*[：:]?\s*(\d+)/i;
    const spo2 = text.match(spo2Pattern);
    if (spo2) {
        const val = parseInt(spo2[1]);
        if (val < v.spo2.min) {
            alerts.push({ type:'vital_abnormal', severity:'critical', item:'血氧',
                detected:`${val}%`, range:`≥ ${v.spo2.min}%`,
                message:v.spo2.warning_low });
        }
    }

    // ── 體溫（Body Temperature）──
    // 支援格式：BT 38.5, BT: 38.5, BT：38.5, 體溫 38.5, T 38.5（T 後面必須接數字避免誤判）
    const btPattern = /(?:BT|體溫)\s*[：:]?\s*([\d.]+)|(?:^|\s)T\s*[：:]?\s*([\d.]+)/i;
    const bt = text.match(btPattern);
    if (bt) {
        const val = parseFloat(bt[1] || bt[2]);
        if (!isNaN(val) && (val > v.body_temp.max || val < v.body_temp.min)) {
            alerts.push({ type:'vital_abnormal', severity:'warning', item:'體溫',
                detected:`${val}°C`, range:`${v.body_temp.min}-${v.body_temp.max}°C`,
                message: val > v.body_temp.max ? v.body_temp.warning_high : v.body_temp.warning_low });
        }
    }

    // ── 呼吸速率（Respiratory Rate）──
    // 支援格式：RR 22, RR: 22, RR：22, 呼吸 22
    const rrPattern = /(?:RR|呼吸)\s*[：:]?\s*(\d+)/i;
    const rr = text.match(rrPattern);
    if (rr) {
        const val = parseInt(rr[1]);
        if (val > v.respiratory_rate.max || val < v.respiratory_rate.min) {
            alerts.push({ type:'vital_abnormal', severity:'warning', item:'呼吸速率',
                detected:`${val} 次/分`, range:`${v.respiratory_rate.min}-${v.respiratory_rate.max} 次/分`,
                message: val > v.respiratory_rate.max ? v.respiratory_rate.warning_high : v.respiratory_rate.warning_low });
        }
    }

    return alerts;
}

// 只在瀏覽器環境自動載入藥物資料庫（Node.js 測試環境跳過）
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
