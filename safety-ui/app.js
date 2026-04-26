/**
 * VoiceNursy — 真實版（無假資料）
 * 所有功能都透過後端 API 真實運作
 */

const API_BASE = 'http://localhost:8001';
let authToken = null;
let currentUser = null;
let currentPatient = null;
let currentAlerts = [];
let currentOutput = null;
let allRecords = {};
let totalAlerts = 0;

// 病患資料（實際會從後端取得，這裡模擬 3 位住院病患）
const PATIENTS = [
    { id: 'P001', name: '王大明', bed: '3A-01', mrn: 'M20240001', dx: '右膝關節置換術後 Day 2', age: 72, allergies: ['Penicillin', 'Ampicillin'] },
    { id: 'P002', name: '李美華', bed: '3A-05', mrn: 'M20240002', dx: '肺炎住院治療 Day 5', age: 58, allergies: ['Aspirin', 'NSAIDs'] },
    { id: 'P003', name: '張阿公', bed: '3A-08', mrn: 'M20240003', dx: '糖尿病足傷口照護', age: 81, allergies: [] },
];
PATIENTS.forEach(p => { allRecords[p.id] = []; });

// ══════════════════════════════════════
// 註冊 / 登入（真實 API）
// ══════════════════════════════════════

function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
}

async function doRegister() {
    const id = document.getElementById('reg-id').value.trim();
    const pw = document.getElementById('reg-pw').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const errEl = document.getElementById('reg-error');
    errEl.textContent = '';

    if (!id || !pw || !name) { errEl.textContent = '請填寫所有欄位'; return; }

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id: id, password: pw, name: name }),
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.detail || '註冊失敗'; return; }
        alert('註冊成功！請登入');
        showLogin();
        document.getElementById('login-id').value = id;
    } catch (e) {
        errEl.textContent = '無法連線到伺服器，請確認後端已啟動';
    }
}

async function doLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value.trim();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';

    if (!id || !pw) { errEl.textContent = '請填寫員工編號和密碼'; return; }

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id: id, password: pw }),
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.detail || '登入失敗'; return; }

        authToken = data.token;
        currentUser = data.user;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        document.getElementById('current-nurse').textContent = `護理師：${currentUser.name}`;
        renderPatientList();
        selectPatient(PATIENTS[0].id);
        initPainChart();
    } catch (e) {
        errEl.textContent = '無法連線到伺服器，請確認後端已啟動（python -m uvicorn api:app --port 8001）';
    }
}

function doLogout() {
    authToken = null;
    currentUser = null;
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ══════════════════════════════════════
// Tab 切換
// ══════════════════════════════════════

function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('tab-patrol').classList.toggle('hidden', tab !== 'patrol');
    document.getElementById('tab-handover').classList.toggle('hidden', tab !== 'handover');
    if (tab === 'handover') renderHandover();
}

// ══════════════════════════════════════
// 病患選擇
// ══════════════════════════════════════

function renderPatientList() {
    const el = document.getElementById('patient-list');
    el.innerHTML = PATIENTS.map(p => {
        const ac = allRecords[p.id].reduce((s, r) => s + (r.alerts?.length || 0), 0);
        return `<div class="patient-chip" id="chip-${p.id}" onclick="selectPatient('${p.id}')">
            ${p.bed} ${p.name}${ac > 0 ? `<span class="chip-alert">⚠${ac}</span>` : ''}
        </div>`;
    }).join('');
}

function selectPatient(id) {
    currentPatient = PATIENTS.find(p => p.id === id);
    document.querySelectorAll('.patient-chip').forEach(c => c.classList.remove('active'));
    document.getElementById(`chip-${id}`)?.classList.add('active');
    document.getElementById('patient-name').textContent = `${currentPatient.name}（${currentPatient.age}歲）`;
    document.getElementById('patient-bed').textContent = currentPatient.bed;
    document.getElementById('patient-dx').innerHTML = currentPatient.dx +
        (currentPatient.allergies?.length
            ? ' ' + currentPatient.allergies.map(a => `<span class="allergy-tag">⚠ ${a} 過敏</span>`).join(' ')
            : '');
    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.add('hidden');
    document.getElementById('processing').classList.add('hidden');
    document.getElementById('transcript-area').classList.add('hidden');
    renderTimeline();
    updatePainChart();
}

// ══════════════════════════════════════
// 語音錄音（真實 Web Audio API）
// ══════════════════════════════════════

let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            handleRecordingDone();
        };
        mediaRecorder.start(100); // 每 100ms 收集一次
        recordSeconds = 0;
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('recording-indicator').classList.remove('hidden');
        recordTimer = setInterval(() => {
            recordSeconds++;
            document.getElementById('record-timer').textContent = `${recordSeconds}s`;
        }, 1000);
    } catch (e) {
        alert('無法存取麥克風：' + e.message + '\n請用 HTTPS 或 localhost 開啟頁面');
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

async function handleRecordingDone() {
    if (!audioChunks.length) return;

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log(`[錄音] 完成，大小：${(audioBlob.size / 1024).toFixed(1)} KB`);

    // 顯示處理中
    document.getElementById('processing').classList.remove('hidden');
    document.getElementById('transcript-area').classList.add('hidden');

    // 真實 STT：上傳音檔到後端
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const res = await fetch(`${API_BASE}/stt/transcribe`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error(`STT API 錯誤 ${res.status}`);
        const sttResult = await res.json();

        document.getElementById('processing').classList.add('hidden');
        document.getElementById('transcript-text').value = sttResult.cleaned_text || sttResult.text;
        document.getElementById('transcript-area').classList.remove('hidden');

        // 顯示辨識信心度
        const conf = sttResult.confidence ? `（信心度 ${(sttResult.confidence * 100).toFixed(0)}%）` : '';
        console.log(`[STT] 辨識結果${conf}：${sttResult.text}`);

    } catch (e) {
        document.getElementById('processing').classList.add('hidden');
        console.error('[STT] 失敗', e);
        alert('語音辨識失敗：' + e.message + '\n請確認後端 STT 服務已啟動');
    }
}

function clearTranscript() {
    document.getElementById('transcript-text').value = '';
    document.getElementById('transcript-area').classList.add('hidden');
}

// ══════════════════════════════════════
// 送給 Brain（真實 LLM）
// ══════════════════════════════════════

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
        const res = await fetch(`${API_BASE}/brain/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_text: rawText }),
        });
        if (!res.ok) throw new Error(`Brain API 錯誤 ${res.status}`);
        output = await res.json();
    } catch (e) {
        document.getElementById('processing').classList.add('hidden');
        alert('SOAP 生成失敗：' + e.message + '\n請確認 Ollama 正在運行（ollama serve）');
        return;
    }

    currentOutput = output;
    currentAlerts = checkSafety(output);

    document.getElementById('processing').classList.add('hidden');
    displaySOAP(output);

    if (currentAlerts.length > 0) showAlert(currentAlerts[0]);
}

// ══════════════════════════════════════
// 顯示 SOAP
// ══════════════════════════════════════

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

// ══════════════════════════════════════
// 警示
// ══════════════════════════════════════

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

// ══════════════════════════════════════
// 存檔
// ══════════════════════════════════════

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

    // IndexedDB 離線備份
    if (typeof saveRecordLocally === 'function') {
        saveRecordLocally({
            patientId: currentPatient.id,
            patientName: currentPatient.name,
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: currentOutput.pain_scale,
            alerts: currentAlerts,
            time,
        }).catch(e => console.warn('[Offline] 本地存檔失敗', e));
    }

    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.remove('hidden');
    document.getElementById('transcript-area').classList.add('hidden');

    renderTimeline();
    updatePainChart();
    renderPatientList();

    // 更新時間軸
    if (currentOutput.medications) {
        for (const med of currentOutput.medications) {
            const danger = currentAlerts.some(a => a.item === med.name);
            if (typeof addTimelineEvent === 'function') {
                addTimelineEvent(time, `${med.name} ${med.dose||''} ${med.unit||''} ${med.route||''}`, danger);
            }
        }
    }
    if (currentOutput.pain_scale != null && typeof addPainDataPoint === 'function') {
        addPainDataPoint(time, currentOutput.pain_scale);
    }

    setTimeout(() => { document.getElementById('save-ok').classList.add('hidden'); }, 2500);
}

// ══════════════════════════════════════
// 側面板
// ══════════════════════════════════════

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
            <span>${meds || r.soap?.plan || '護理紀錄'}${danger?' ⚠️':''}</span>
        </div>`;
    }).reverse().join('');
}

// ══════════════════════════════════════
// 交班儀表板
// ══════════════════════════════════════

function renderHandover() {
    const totalRecords = Object.values(allRecords).reduce((s, r) => s + r.length, 0);
    document.getElementById('stat-patients').textContent = PATIENTS.length;
    document.getElementById('stat-alerts').textContent = totalAlerts;
    document.getElementById('stat-records').textContent = totalRecords;

    const container = document.getElementById('handover-patients');
    container.innerHTML = PATIENTS.map(p => {
        const records = allRecords[p.id];
        const ac = records.reduce((s, r) => s + (r.alerts?.length || 0), 0);
        return `<div class="ho-patient">
            <div class="ho-patient-header">
                <span class="ho-patient-name">${p.name}（${p.age}歲）${ac > 0 ? ' ⚠️' : ''}</span>
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
