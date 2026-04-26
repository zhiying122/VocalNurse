/**
 * 主應用邏輯：整合 A（輸入）、B（Brain API）、C（防呆 + UI）
 */

const BRAIN_API_URL = 'http://localhost:8001/brain/process';
let currentAlerts = [];
let currentBrainOutput = null;

/**
 * 載入範例文字（模擬角色 A 的輸出）
 */
function loadDemo() {
    document.getElementById('raw-input').value =
        '阿公今天傷口發紅，pain scale 4分，BP 140/90，HR 88，BT 37.2，PRN 給一顆 Voren 25mg';
}

/**
 * 處理輸入：送給 Brain API → 防呆檢查 → 顯示 SOAP
 */
async function processInput() {
    const rawText = document.getElementById('raw-input').value.trim();
    if (!rawText) {
        alert('請輸入文字');
        return;
    }

    // 嘗試呼叫 Brain API（角色 B）
    let brainOutput;
    try {
        const res = await fetch(BRAIN_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText }),
        });

        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
        brainOutput = await res.json();
    } catch (e) {
        console.warn('[App] Brain API 無法連線，使用模擬資料', e.message);
        brainOutput = generateMockOutput(rawText);
    }

    currentBrainOutput = brainOutput;

    // 防呆檢查（角色 C 核心）
    currentAlerts = checkSafety(brainOutput);

    // 顯示 SOAP 卡片
    displaySOAP(brainOutput);

    // 若有警示，觸發紅色警示
    if (currentAlerts.length > 0) {
        showAlert(currentAlerts[0]);
    }
}

/**
 * 顯示 SOAP 卡片
 */
function displaySOAP(output) {
    document.getElementById('soap-s').textContent = output.soap.subjective || '（無資料）';
    document.getElementById('soap-o').textContent = output.soap.objective || '（無資料）';
    document.getElementById('soap-a').textContent = output.soap.assessment || '（無資料）';
    document.getElementById('soap-p').textContent = output.soap.plan || '（無資料）';

    // 藥物資訊
    const medSection = document.getElementById('medications-section');
    const medList = document.getElementById('medications-list');
    if (output.medications && output.medications.length > 0) {
        medSection.classList.remove('hidden');
        medList.innerHTML = output.medications.map(med => {
            const isDanger = currentAlerts.some(a => a.item === med.name);
            return `
                <div class="med-item ${isDanger ? 'danger' : ''}">
                    <span class="med-name">${med.name}</span>
                    <span class="med-dose">${med.dose || ''} ${med.unit || ''} ${med.route || ''}</span>
                </div>
            `;
        }).join('');
    } else {
        medSection.classList.add('hidden');
    }

    // Pain Scale
    const painSection = document.getElementById('pain-section');
    const painDisplay = document.getElementById('pain-display');
    if (output.pain_scale !== null && output.pain_scale !== undefined) {
        painSection.classList.remove('hidden');
        const score = output.pain_scale;
        const level = score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low';
        const color = score >= 7 ? '#c62828' : score >= 4 ? '#f57c00' : '#388e3c';
        painDisplay.innerHTML = `
            <div class="pain-number pain-${level}">${score}</div>
            <div style="flex:1">
                <div class="pain-bar">
                    <div class="pain-bar-fill" style="width:${score * 10}%; background:${color}"></div>
                </div>
                <small style="color:#888">0 = 無痛 ─── 10 = 劇痛</small>
            </div>
        `;

        // 更新趨勢圖
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        addPainDataPoint(timeStr, score);
    } else {
        painSection.classList.add('hidden');
    }

    // 更新時間軸
    if (output.medications) {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        for (const med of output.medications) {
            const isDanger = currentAlerts.some(a => a.item === med.name);
            addTimelineEvent(timeStr, `${med.name} ${med.dose || ''} ${med.unit || ''} ${med.route || ''}`, isDanger);
        }
    }

    document.getElementById('soap-cards').classList.remove('hidden');
    document.getElementById('save-animation').classList.add('hidden');
}

/**
 * 顯示紅色警示覆蓋層
 */
function showAlert(alert) {
    document.getElementById('alert-message').textContent = alert.message;
    document.getElementById('alert-detected').textContent = alert.detected;
    document.getElementById('alert-range').textContent = alert.range;
    document.getElementById('alert-overlay').classList.remove('hidden');

    // 播放提示音
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.3;
        osc.start();
        setTimeout(() => { osc.stop(); audioCtx.close(); }, 300);
    } catch (e) { /* 靜音模式 */ }
}

/**
 * 確認知悉警示
 */
function acknowledgeAlert() {
    document.getElementById('alert-overlay').classList.add('hidden');
    console.log('[Safety] 護理師確認知悉警示');
}

/**
 * 修改數值（關閉警示，聚焦到 SOAP 編輯）
 */
function editSOAP() {
    document.getElementById('alert-overlay').classList.add('hidden');
    document.getElementById('soap-p').focus();
}

/**
 * 確認存檔（含動畫）
 */
function confirmSave() {
    // 檢查是否有未處理的警示
    if (currentAlerts.length > 0) {
        const confirmed = confirm('此紀錄有安全警示，確定要存檔嗎？');
        if (!confirmed) return;
    }

    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-animation').classList.remove('hidden');

    console.log('[存檔] 病歷已歸檔', currentBrainOutput);

    // 3 秒後重置
    setTimeout(() => {
        document.getElementById('save-animation').classList.add('hidden');
        document.getElementById('raw-input').value = '';
        currentAlerts = [];
        currentBrainOutput = null;
    }, 3000);
}

/**
 * 模擬 Brain 輸出（當 API 無法連線時使用）
 */
function generateMockOutput(rawText) {
    return {
        soap: {
            subjective: rawText.includes('痛') ? '病患主訴疼痛' : '',
            objective: extractObjective(rawText),
            assessment: '持續觀察中',
            plan: rawText,
        },
        medications: extractMedications(rawText),
        pain_scale: extractPainScale(rawText),
        warnings: [],
        raw_text: rawText,
    };
}

function extractObjective(text) {
    const parts = [];
    const bp = text.match(/BP\s*\d+\/\d+/i);
    const hr = text.match(/HR\s*\d+/i);
    const bt = text.match(/BT\s*[\d.]+/i);
    const spo2 = text.match(/SpO2\s*\d+/i);
    if (bp) parts.push(bp[0]);
    if (hr) parts.push(hr[0]);
    if (bt) parts.push(bt[0]);
    if (spo2) parts.push(spo2[0]);
    return parts.join(', ');
}

function extractMedications(text) {
    const meds = [];
    const patterns = [
        /(\w+)\s+(\d+)\s*(mg|g|ml)/gi,
        /(普拿疼|Voren|Aspirin|Voltaren)\s*(\d+)?\s*(mg|顆)?/gi,
    ];
    for (const pat of patterns) {
        let match;
        while ((match = pat.exec(text)) !== null) {
            meds.push({
                name: match[1],
                dose: match[2] || null,
                unit: match[3] || null,
                route: text.includes('PRN') ? 'PRN' : 'PO',
                raw: match[0],
            });
        }
    }
    return meds;
}

function extractPainScale(text) {
    const match = text.match(/pain\s*scale\s*(\d+)/i);
    return match ? parseInt(match[1]) : null;
}
