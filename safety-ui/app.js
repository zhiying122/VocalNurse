/**
 * VoiceNursy 主應用 — 完整 Demo 版
 * 登入 → 選病患 → 語音錄音 → SOAP → 防呆 → 存檔 → 交班
 */

const BRAIN_API = 'http://localhost:8001/brain/process';

// ── 模擬病患資料 ──
const PATIENTS = [
    { id: 'P001', name: '王大明', bed: '3A-01', mrn: 'M20240001', dx: '右膝關節置換術後 Day 2', age: 72 },
    { id: 'P002', name: '李美華', bed: '3A-05', mrn: 'M20240002', dx: '肺炎住院治療 Day 5', age: 58 },
    { id: 'P003', name: '張阿公', bed: '3A-08', mrn: 'M20240003', dx: '糖尿病足傷口照護', age: 81 },
];

let currentPatient = null;
let currentAlerts = [];
let currentOutput = null;
let allRecords = {};  // patientId -> [{soap, meds, pain, time, alerts}]
let totalAlerts = 0;

// ── 初始化 ──
PATIENTS.forEach(p => { allRecords[p.id] = []; });

// ── 登入 ──
function doLogin() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
    renderPatientList();
    selectPatient(PATIENTS[0].id);
    initPainChart();
}

function doLogout() {
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ── Tab 切換 ──
function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('tab-patrol').classList.toggle('hidden', tab !== 'patrol');
    document.getElementById('tab-handover').classList.toggle('hidden', tab !== 'handover');
    if (tab === 'handover') renderHandover();
}

// ── 病患選擇 ──
function renderPatientList() {
    const el = document.getElementById('patient-list');
    el.innerHTML = PATIENTS.map(p => {
        const alertCount = allRecords[p.id].reduce((sum, r) => sum + (r.alerts?.length || 0), 0);
        return `<div class="patient-chip" id="chip-${p.id}" onclick="selectPatient('${p.id}')">
            ${p.bed} ${p.name}${alertCount > 0 ? `<span class="chip-alert">⚠${alertCount}</span>` : ''}
        </div>`;
    }).join('');
}

function selectPatient(id) {
    currentPatient = PATIENTS.find(p => p.id === id);
    document.querySelectorAll('.patient-chip').forEach(c => c.classList.remove('active'));
    document.getElementById(`chip-${id}`)?.classList.add('active');
    document.getElementById('patient-name').textContent = `${currentPatient.name}（${currentPatient.age}歲）`;
    document.getElementById('patient-bed').textContent = currentPatient.bed;
    document.getElementById('patient-dx').textContent = currentPatient.dx;
    // 重置 SOAP 區
    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.add('hidden');
    document.getElementById('processing').classList.add('hidden');
    // 更新側面板
    renderTimeline();
    updatePainChart();
}

// ── 語音錄音（Web Audio API）──
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            handleRecordingComplete();
        };
        mediaRecorder.start();
        recordSeconds = 0;
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('recording-indicator').classList.remove('hidden');
        recordTimer = setInterval(() => {
            recordSeconds++;
            document.getElementById('record-timer').textContent = `${recordSeconds}s`;
        }, 1000);
    } catch (e) {
        console.warn('麥克風無法存取', e);
        alert('無法存取麥克風，請確認瀏覽器權限。可使用下方手動輸入。');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        clearInterval(recordTimer);
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('recording-indicator').classList.add('hidden');
    }
}

async function handleRecordingComplete() {
    // 目前使用模擬 STT（因為瀏覽器端無法直接跑 Whisper）
    // 實際部署時會將音檔傳到後端 STT 服務
    const demoTexts = [
        `${currentPatient?.name || '病患'}今天傷口發紅，pain scale 4分，BP 140/90，HR 88，BT 37.2，PRN 給一顆 Voltaren 25mg`,
        `${currentPatient?.name || '病患'}主訴頭痛，pain scale 6分，BP 158/95，HR 96，BT 38.1，給 Acetaminophen 500mg PO`,
        `${currentPatient?.name || '病患'}傷口換藥完成，滲液少量，pain scale 2分，BP 125/80，HR 76，SpO2 98%`,
    ];
    const text = demoTexts[Math.floor(Math.random() * demoTexts.length)];

    document.getElementById('transcript-text').value = text;
    document.getElementById('transcript-area').classList.remove('hidden');
}

function clearTranscript() {
    document.getElementById('transcript-text').value = '';
    document.getElementById('transcript-area').classList.add('hidden');
}

// ── 送給 Brain ──
async function sendToBrain() {
    const text = document.getElementById('transcript-text').value.trim();
    if (!text) return;
    await processBrain(text);
}

function sendManualText() {
    const text = document.getElementById('manual-text').value.trim();
    if (!text) return;
    processBrain(text);
}

async function processBrain(rawText) {
    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.add('hidden');
    document.getElementById('processing').classList.remove('hidden');

    let output;
    try {
        const res = await fetch(BRAIN_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText }),
        });
        if (!res.ok) throw new Error(res.status);
        output = await res.json();
    } catch (e) {
        console.warn('Brain API 離線，使用模擬', e);
        output = mockBrain(rawText);
    }

    currentOutput = output;
    currentAlerts = checkSafety(output);

    document.getElementById('processing').classList.add('hidden');
    displaySOAP(output);

    if (currentAlerts.length > 0) showAlert(currentAlerts[0]);
}

// ── 顯示 SOAP ──
function displaySOAP(o) {
    document.getElementById('soap-s').textContent = o.soap.subjective || '（無資料）';
    document.getElementById('soap-o').textContent = o.soap.objective || '（無資料）';
    document.getElementById('soap-a').textContent = o.soap.assessment || '（無資料）';
    document.getElementById('soap-p').textContent = o.soap.plan || '（無資料）';

    const medSec = document.getElementById('med-section');
    const medList = document.getElementById('med-list');
    if (o.medications?.length) {
        medSec.classList.remove('hidden');
        medList.innerHTML = o.medications.map(m => {
            const danger = currentAlerts.some(a => a.item === m.name);
            return `<div class="med-item ${danger ? 'danger' : ''}">
                <span>${m.name}</span><span>${m.dose || ''} ${m.unit || ''} ${m.route || ''}</span>
            </div>`;
        }).join('');
    } else medSec.classList.add('hidden');

    const painSec = document.getElementById('pain-section');
    if (o.pain_scale != null) {
        painSec.classList.remove('hidden');
        const s = o.pain_scale;
        const lv = s >= 7 ? 'high' : s >= 4 ? 'mid' : 'low';
        const cl = s >= 7 ? '#c62828' : s >= 4 ? '#f57c00' : '#388e3c';
        document.getElementById('pain-display').innerHTML = `
            <div class="pain-num pain-${lv}">${s}</div>
            <div style="flex:1"><div class="pain-bar"><div class="pain-fill" style="width:${s*10}%;background:${cl}"></div></div>
            <small style="color:#888">0 無痛 ─── 10 劇痛</small></div>`;
    } else painSec.classList.add('hidden');

    document.getElementById('soap-cards').classList.remove('hidden');
}

// ── 警示 ──
function showAlert(a) {
    document.getElementById('alert-msg').textContent = a.message;
    document.getElementById('alert-val').textContent = a.detected;
    document.getElementById('alert-range').textContent = a.range;
    document.getElementById('alert-overlay').classList.remove('hidden');
    playAlertSound();
}
function ackAlert() { document.getElementById('alert-overlay').classList.add('hidden'); }
function editFromAlert() { ackAlert(); document.getElementById('soap-p').focus(); }

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = 800; g.gain.value = 0.3;
        osc.start(); setTimeout(() => { osc.stop(); ctx.close(); }, 300);
    } catch(e) {}
}

// ── 存檔 ──
function confirmSave() {
    if (!currentOutput || !currentPatient) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    allRecords[currentPatient.id].push({
        soap: currentOutput.soap,
        medications: currentOutput.medications,
        pain_scale: currentOutput.pain_scale,
        alerts: currentAlerts,
        time,
        raw: currentOutput.raw_text,
    });
    totalAlerts += currentAlerts.length;

    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.remove('hidden');
    document.getElementById('transcript-area').classList.add('hidden');

    renderTimeline();
    updatePainChart();
    renderPatientList();

    setTimeout(() => {
        document.getElementById('save-ok').classList.add('hidden');
    }, 2500);
}

// ── 側面板時間軸 ──
function renderTimeline() {
    if (!currentPatient) return;
    const records = allRecords[currentPatient.id];
    const el = document.getElementById('timeline');
    if (!records.length) { el.innerHTML = '<p style="color:#999;font-size:.85rem">尚無紀錄</p>'; return; }
    el.innerHTML = records.map(r => {
        const danger = r.alerts?.length > 0;
        const meds = r.medications?.map(m => `${m.name} ${m.dose||''} ${m.unit||''}`).join(', ') || '';
        return `<div class="tl-item ${danger?'danger':''}">
            <span class="tl-time">${r.time}</span>
            <span>${meds || r.soap.plan || '護理紀錄'}${danger?' ⚠️':''}</span>
        </div>`;
    }).reverse().join('');
}

// ── 模擬 Brain 輸出 ──
function mockBrain(text) {
    const pain = text.match(/pain\s*scale\s*(\d+)/i);
    const bp = text.match(/BP\s*(\d+\/\d+)/i);
    const hr = text.match(/HR\s*(\d+)/i);
    const bt = text.match(/BT\s*([\d.]+)/i);
    const spo2 = text.match(/SpO2\s*(\d+)/i);

    const objParts = [];
    if (bp) objParts.push(`BP ${bp[1]} mmHg`);
    if (hr) objParts.push(`HR ${hr[1]} bpm`);
    if (bt) objParts.push(`BT ${bt[1]}°C`);
    if (spo2) objParts.push(`SpO2 ${spo2[1]}%`);

    const meds = [];
    const medPattern = /(Acetaminophen|Voltaren|Voren|Aspirin|普拿疼|Amlodipine)\s*(\d+)?\s*(mg|顆)?/gi;
    let m;
    while ((m = medPattern.exec(text)) !== null) {
        meds.push({ name: m[1], dose: m[2]||null, unit: m[3]||'mg', route: text.match(/PRN/i)?'PRN':'PO', raw: m[0] });
    }

    return {
        soap: {
            subjective: text.includes('痛') || text.includes('頭') ? '病患主訴疼痛不適' : '病患無特殊主訴',
            objective: objParts.join(', ') || text,
            assessment: pain && parseInt(pain[1]) >= 4 ? '疼痛控制需持續評估' : '目前狀況穩定',
            plan: meds.length ? `依醫囑給予 ${meds.map(m=>`${m.name} ${m.dose||''}${m.unit||''}`).join(', ')}` : '持續觀察',
        },
        medications: meds,
        pain_scale: pain ? parseInt(pain[1]) : null,
        warnings: [],
        raw_text: text,
    };
}

// ── 交班儀表板 ──
function renderHandover() {
    const totalRecords = Object.values(allRecords).reduce((s, r) => s + r.length, 0);
    document.getElementById('stat-patients').textContent = PATIENTS.length;
    document.getElementById('stat-alerts').textContent = totalAlerts;
    document.getElementById('stat-records').textContent = totalRecords;

    const container = document.getElementById('handover-patients');
    container.innerHTML = PATIENTS.map(p => {
        const records = allRecords[p.id];
        const alertCount = records.reduce((s, r) => s + (r.alerts?.length || 0), 0);
        return `<div class="ho-patient">
            <div class="ho-patient-header">
                <span class="ho-patient-name">${p.name}（${p.age}歲）${alertCount > 0 ? ' ⚠️' : ''}</span>
                <span class="ho-patient-bed">${p.bed} | ${p.dx}</span>
            </div>
            <div class="ho-records">
                ${records.length ? records.map(r => `
                    <div class="ho-record ${r.alerts?.length ? 'has-alert' : ''}">
                        <strong>${r.time}</strong> — 
                        Pain: ${r.pain_scale ?? '-'} | 
                        ${r.medications?.map(m => `${m.name} ${m.dose||''}${m.unit||''}`).join(', ') || '無給藥'}
                        ${r.alerts?.length ? ' ⚠️ 有警示' : ''}
                    </div>
                `).join('') : '<div class="ho-record">尚無紀錄</div>'}
            </div>
        </div>`;
    }).join('');
}
