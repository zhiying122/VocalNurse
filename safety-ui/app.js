/**
 * VoiceNursy — 完整真實版
 */
const API = 'http://localhost:8001';

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') {
            throw new Error('API 請求逾時，請檢查網路連線');
        }
        throw e;
    }
}

let authToken = null;
let currentUser = null;
let currentPatient = null;
let currentAlerts = [];
let currentOutput = null;
let allRecords = {};
let totalAlerts = 0;
let patients = [];

// ══════════════════════════════════════
// 認證
// ══════════════════════════════════════
function showRegister() { document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); }
function showLogin() { document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); }

async function doRegister() {
    const id = document.getElementById('reg-id').value.trim();
    const pw = document.getElementById('reg-pw').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const err = document.getElementById('reg-error');
    err.textContent = '';
    if (!id || !pw || !name) { err.textContent = '請填寫所有欄位'; return; }
    try {
        const res = await fetchWithTimeout(`${API}/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({employee_id:id,password:pw,name}) });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.detail || '註冊失敗'; return; }
        alert('註冊成功！請登入'); showLogin(); document.getElementById('login-id').value = id;
    } catch(e) { err.textContent = e.message === 'API 請求逾時，請檢查網路連線' ? e.message : '無法連線到伺服器'; }
}

async function doLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value.trim();
    const err = document.getElementById('login-error');
    err.textContent = '';
    if (!id || !pw) { err.textContent = '請填寫所有欄位'; return; }
    try {
        const res = await fetchWithTimeout(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({employee_id:id,password:pw}) });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.detail || '登入失敗'; return; }
        authToken = data.token; currentUser = data.user;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        document.getElementById('current-nurse').textContent = `護理師：${currentUser.name}`;
        await loadPatients();
        initPainChart();
        initMedicationTimeline();
    } catch(e) { err.textContent = e.message === 'API 請求逾時，請檢查網路連線' ? e.message : '無法連線到伺服器，請確認後端已啟動'; }
}

function doLogout() { authToken=null; currentUser=null; document.getElementById('main-screen').classList.add('hidden'); document.getElementById('login-screen').classList.remove('hidden'); }

// ══════════════════════════════════════
// 病患管理（真實 API）
// ══════════════════════════════════════
async function loadPatients() {
    try {
        const res = await fetchWithTimeout(`${API}/patients`);
        patients = await res.json();
    } catch(e) { patients = []; }
    patients.forEach(p => { if (!allRecords[p.id]) allRecords[p.id] = []; });
    renderPatientList();
    if (patients.length > 0) selectPatient(patients[0].id);
}

function renderPatientList() {
    const el = document.getElementById('patient-list');
    if (!patients.length) { el.innerHTML = '<p style="color:#999;font-size:.85rem">尚無病患，請點「新增病患」</p>'; return; }
    el.innerHTML = patients.map(p => {
        const ac = (allRecords[p.id]||[]).reduce((s,r) => s + (r.alerts?.length||0), 0);
        return `<div class="patient-chip" id="chip-${p.id}" onclick="selectPatient('${p.id}')">${p.bed} ${p.name}${ac>0?`<span class="chip-alert">⚠${ac}</span>`:''}</div>`;
    }).join('');
}

function selectPatient(id) {
    currentPatient = patients.find(p => p.id === id);
    if (!currentPatient) return;
    if (!allRecords[id]) allRecords[id] = [];
    document.querySelectorAll('.patient-chip').forEach(c => c.classList.remove('active'));
    document.getElementById(`chip-${id}`)?.classList.add('active');
    document.getElementById('patient-name').textContent = `${currentPatient.name}（${currentPatient.age}歲）`;
    document.getElementById('patient-bed').textContent = currentPatient.bed;
    document.getElementById('patient-dx').innerHTML = currentPatient.dx +
        (currentPatient.allergies?.length ? ' ' + currentPatient.allergies.map(a=>`<span class="allergy-tag">⚠ ${a} 過敏</span>`).join(' ') : '');
    document.getElementById('patient-info').classList.remove('hidden');
    document.getElementById('main-area').style.display = '';
    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.add('hidden');
    document.getElementById('processing').classList.add('hidden');
    document.getElementById('transcript-area').classList.add('hidden');
    renderTimeline(); updatePainChart();
    updateMedicationTimeline(allRecords[id] || [], []);
}

function showAddPatient() { document.getElementById('add-patient-form').classList.remove('hidden'); }
function hideAddPatient() { document.getElementById('add-patient-form').classList.add('hidden'); }

async function submitPatient() {
    const name = document.getElementById('pt-name').value.trim();
    const bed = document.getElementById('pt-bed').value.trim();
    const age = parseInt(document.getElementById('pt-age').value) || 0;
    const dx = document.getElementById('pt-dx').value.trim();
    const allergiesStr = document.getElementById('pt-allergies').value.trim();
    const allergies = allergiesStr ? allergiesStr.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
    if (!name || !bed) { alert('請至少填寫姓名和床號'); return; }
    try {
        const res = await fetchWithTimeout(`${API}/patients`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,bed,dx,age,allergies}) });
        if (!res.ok) throw new Error('新增失敗');
        hideAddPatient();
        ['pt-name','pt-bed','pt-age','pt-dx','pt-allergies'].forEach(id => document.getElementById(id).value = '');
        await loadPatients();
    } catch(e) { alert('新增病患失敗：' + e.message); }
}

async function removePatient() {
    if (!currentPatient || !confirm(`確定移除 ${currentPatient.name}？`)) return;
    try {
        await fetchWithTimeout(`${API}/patients/${currentPatient.id}`, { method:'DELETE' });
        currentPatient = null;
        document.getElementById('patient-info').classList.add('hidden');
        document.getElementById('main-area').style.display = 'none';
        await loadPatients();
    } catch(e) { alert('移除失敗'); }
}

// ══════════════════════════════════════
// 錄音（點一下開始，再點一下停止）
// ══════════════════════════════════════
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;
let isRecording = false;

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!currentPatient) { alert('請先選擇病患'); return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); handleRecordingDone(); };
        mediaRecorder.start(100);
        isRecording = true;
        recordSeconds = 0;
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('record-label').textContent = '點擊停止錄音';
        document.getElementById('recording-indicator').classList.remove('hidden');
        recordTimer = setInterval(() => { recordSeconds++; document.getElementById('record-timer').textContent = `${recordSeconds}s`; }, 1000);
    } catch(e) { alert('無法存取麥克風：' + e.message); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        clearInterval(recordTimer);
        isRecording = false;
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('record-label').textContent = '點擊開始錄音';
        document.getElementById('recording-indicator').classList.add('hidden');
    }
}

async function handleRecordingDone() {
    if (!audioChunks.length) return;
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log(`[錄音] 完成，大小：${(blob.size/1024).toFixed(1)} KB`);

    const autoMode = document.getElementById('auto-mode').checked;

    if (autoMode) {
        // 一站式：音檔直接送 pipeline/full
        document.getElementById('processing').classList.remove('hidden');
        document.getElementById('transcript-area').classList.add('hidden');
        try {
            const fd = new FormData();
            fd.append('audio', blob, 'recording.webm');
            const res = await fetchWithTimeout(`${API}/pipeline/full`, { method:'POST', body: fd });
            if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
            const data = await res.json();
            document.getElementById('processing').classList.add('hidden');
            // 顯示轉錄結果
            document.getElementById('transcript-text').value = data.stt.cleaned_text;
            document.getElementById('transcript-area').classList.remove('hidden');
            // 直接顯示 SOAP
            currentOutput = data.brain;
            currentAlerts = checkSafety(data.brain, allRecords[currentPatient.id] || []);
            displaySOAP(data.brain);
            if (currentAlerts.length > 0) showAlerts(currentAlerts);
        } catch(e) {
            document.getElementById('processing').classList.add('hidden');
            alert('處理失敗：' + e.message);
        }
    } else {
        // 分步模式：先 STT，再手動按 SOAP
        document.getElementById('processing').classList.remove('hidden');
        try {
            const fd = new FormData();
            fd.append('audio', blob, 'recording.webm');
            const res = await fetchWithTimeout(`${API}/stt/transcribe`, { method:'POST', body: fd });
            if (!res.ok) throw new Error(`STT 錯誤 ${res.status}`);
            const data = await res.json();
            document.getElementById('processing').classList.add('hidden');
            document.getElementById('transcript-text').value = data.cleaned_text || data.text;
            document.getElementById('transcript-area').classList.remove('hidden');
        } catch(e) {
            document.getElementById('processing').classList.add('hidden');
            alert('語音辨識失敗：' + e.message);
        }
    }
}

function clearTranscript() { document.getElementById('transcript-text').value=''; document.getElementById('transcript-area').classList.add('hidden'); }

// ══════════════════════════════════════
// SOAP
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
    try {
        const res = await fetchWithTimeout(`${API}/brain/process`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({raw_text:rawText}) });
        if (!res.ok) throw new Error(`${res.status}`);
        const output = await res.json();
        currentOutput = output;
        currentAlerts = checkSafety(output, allRecords[currentPatient.id] || []);
        document.getElementById('processing').classList.add('hidden');
        displaySOAP(output);
        if (currentAlerts.length > 0) showAlerts(currentAlerts);
    } catch(e) {
        document.getElementById('processing').classList.add('hidden');
        alert('SOAP 生成失敗：' + e.message + '\n請確認 Ollama 正在運行');
    }
}

function displaySOAP(o) {
    document.getElementById('soap-s').textContent = o.soap.subjective || '（無資料）';
    document.getElementById('soap-o').textContent = o.soap.objective || '（無資料）';
    document.getElementById('soap-a').textContent = o.soap.assessment || '（無資料）';
    document.getElementById('soap-p').textContent = o.soap.plan || '（無資料）';
    const medSec = document.getElementById('med-section'), medList = document.getElementById('med-list');
    if (o.medications?.length) {
        medSec.classList.remove('hidden');
        medList.innerHTML = o.medications.map(m => {
            const d = currentAlerts.some(a=>a.item===m.name);
            return `<div class="med-item ${d?'danger':''}"><span>${m.name}</span><span>${m.dose||''} ${m.unit||''} ${m.route||''}</span></div>`;
        }).join('');
    } else medSec.classList.add('hidden');
    const painSec = document.getElementById('pain-section');
    if (o.pain_scale != null) {
        painSec.classList.remove('hidden');
        const s=o.pain_scale, lv=s>=7?'high':s>=4?'mid':'low', cl=s>=7?'#c62828':s>=4?'#f57c00':'#388e3c';
        document.getElementById('pain-display').innerHTML = `<div class="pain-num pain-${lv}">${s}</div><div style="flex:1"><div class="pain-bar"><div class="pain-fill" style="width:${s*10}%;background:${cl}"></div></div><small style="color:#888">0 無痛 ─── 10 劇痛</small></div>`;
    } else painSec.classList.add('hidden');
    document.getElementById('soap-cards').classList.remove('hidden');
}

// ══════════════════════════════════════
// 警示
// ══════════════════════════════════════
let alertQueue = [];
let alertQueueIndex = 0;
let focusTrapCleanup = null;

function showAlerts(alerts) {
    const criticals = alerts.filter(a => a.severity === 'critical');
    const warnings = alerts.filter(a => a.severity === 'warning');

    // Show warning banner (non-blocking)
    if (warnings.length > 0) {
        showWarningBanner(warnings);
    }

    // Show critical alerts sequentially
    if (criticals.length > 0) {
        alertQueue = criticals;
        alertQueueIndex = 0;
        showAlertAtIndex(0);
    }
}

function showAlertAtIndex(index) {
    if (index >= alertQueue.length) {
        alertQueue = [];
        alertQueueIndex = 0;
        return;
    }
    alertQueueIndex = index;
    showAlert(alertQueue[index]);
}

function showWarningBanner(warnings) {
    // Remove existing banner if any
    const existing = document.getElementById('warning-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'warning-banner';
    banner.className = 'warning-banner';
    banner.innerHTML = `
        <span class="warning-banner-icon">⚠️</span>
        <div class="warning-banner-content">
            ${warnings.map(w => `<div>${w.message}</div>`).join('')}
        </div>
        <button class="warning-banner-close" onclick="dismissWarningBanner()">✕</button>
    `;

    // Insert above SOAP cards
    const soapCards = document.getElementById('soap-cards');
    if (soapCards) {
        soapCards.parentNode.insertBefore(banner, soapCards);
    }
}

function dismissWarningBanner() {
    const banner = document.getElementById('warning-banner');
    if (banner) banner.remove();
}

function showAlert(a) {
    document.getElementById('alert-title').textContent = a.type === 'allergy' ? '⛔ 過敏原警示' : '劑量異常警示';
    document.getElementById('alert-msg').textContent = a.message;
    document.getElementById('alert-val').textContent = a.detected;
    document.getElementById('alert-range').textContent = a.range;
    document.getElementById('alert-overlay').classList.remove('hidden');
    try { const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=800;g.gain.value=0.3;o.start();setTimeout(()=>{o.stop();ctx.close()},300); } catch(e){}
    trapFocus(document.getElementById('alert-overlay'));
}
function ackAlert() {
    releaseFocusTrap();
    document.getElementById('alert-overlay').classList.add('hidden');
    alertQueueIndex++;
    if (alertQueueIndex < alertQueue.length) {
        showAlertAtIndex(alertQueueIndex);
    }
}
function editFromAlert() { ackAlert(); document.getElementById('soap-p').focus(); }

function trapFocus(overlayElement) {
    const focusable = overlayElement.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeydown(e) {
        if (e.key === 'Tab') {
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
        if (e.key === 'Escape') {
            ackAlert();
        }
    }

    overlayElement.addEventListener('keydown', handleKeydown);
    first.focus();

    focusTrapCleanup = () => {
        overlayElement.removeEventListener('keydown', handleKeydown);
    };
}

function releaseFocusTrap() {
    if (focusTrapCleanup) {
        focusTrapCleanup();
        focusTrapCleanup = null;
    }
}

// ══════════════════════════════════════
// 存檔
// ══════════════════════════════════════
function confirmSave() {
    if (!currentOutput || !currentPatient) return;

    // Disable save button to prevent double-submit
    const saveBtn = document.querySelector('.confirm-area .btn-success');
    if (saveBtn) saveBtn.disabled = true;

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    const record = {
        soap: currentOutput.soap,
        medications: currentOutput.medications,
        pain_scale: currentOutput.pain_scale,
        alerts: currentAlerts,
        time,
        date: new Date().toISOString().slice(0, 10),
        raw: currentOutput.raw_text
    };

    // Save to local records
    if (!allRecords[currentPatient.id]) allRecords[currentPatient.id] = [];
    allRecords[currentPatient.id].push(record);
    totalAlerts += currentAlerts.length;

    // Save to IndexedDB
    if (typeof saveRecordLocally === 'function') {
        saveRecordLocally({
            patientId: currentPatient.id,
            patientName: currentPatient.name,
            ...record
        }).catch(() => {});
    }

    // Remove any existing save-fail prompt
    const failDiv = document.getElementById('save-fail');
    if (failDiv) failDiv.remove();

    // Show success animation
    document.getElementById('soap-cards').classList.add('hidden');
    document.getElementById('save-ok').classList.remove('hidden');
    document.getElementById('transcript-area').classList.add('hidden');
    renderTimeline(); updatePainChart(); renderPatientList();
    updateMedicationTimeline(allRecords[currentPatient.id] || [], currentAlerts);

    setTimeout(() => {
        document.getElementById('save-ok').classList.add('hidden');
        if (saveBtn) saveBtn.disabled = false;
    }, 2500);
}

function showSaveFailure() {
    const existing = document.getElementById('save-fail');
    if (existing) existing.remove();

    const failDiv = document.createElement('div');
    failDiv.id = 'save-fail';
    failDiv.className = 'save-fail';
    failDiv.innerHTML = `
        <p>⚠️ 存檔失敗</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
            <button class="btn btn-primary" onclick="confirmSave()">重試</button>
            <button class="btn btn-secondary" onclick="saveOffline()">離線暫存</button>
        </div>
    `;

    const soapCards = document.getElementById('soap-cards');
    if (soapCards) soapCards.parentNode.insertBefore(failDiv, soapCards.nextSibling);
}

function saveOffline() {
    if (!currentOutput || !currentPatient) return;
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    if (typeof saveRecordLocally === 'function') {
        saveRecordLocally({
            patientId: currentPatient.id,
            patientName: currentPatient.name,
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: currentOutput.pain_scale,
            alerts: currentAlerts,
            time
        }).then(() => {
            const failDiv = document.getElementById('save-fail');
            if (failDiv) failDiv.remove();
            document.getElementById('soap-cards').classList.add('hidden');
            document.getElementById('save-ok').classList.remove('hidden');
            setTimeout(() => document.getElementById('save-ok').classList.add('hidden'), 2500);
        }).catch(() => alert('離線暫存也失敗了'));
    }
}

// ══════════════════════════════════════
// Tab / Timeline / Handover
// ══════════════════════════════════════
function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('tab-patrol').classList.toggle('hidden', tab!=='patrol');
    document.getElementById('tab-handover').classList.toggle('hidden', tab!=='handover');
    document.getElementById('tab-tech').classList.toggle('hidden', tab!=='tech');
    if (tab==='handover') renderHandover();
}

function renderTimeline() {
    if (!currentPatient) return;
    const records = allRecords[currentPatient.id] || [];
    const el = document.getElementById('timeline');
    if (!records.length) { el.innerHTML='<p style="color:#999;font-size:.85rem">尚無紀錄</p>'; return; }
    el.innerHTML = records.map(r => {
        const d = r.alerts?.length>0;
        const meds = r.medications?.map(m=>`${m.name} ${m.dose||''} ${m.unit||''}`).join(', ')||'';
        return `<div class="tl-item ${d?'danger':''}"><span class="tl-time">${r.time}</span><span>${meds||r.soap?.plan||'護理紀錄'}${d?' ⚠️':''}</span></div>`;
    }).reverse().join('');
}

function renderHandover() {
    const total = Object.values(allRecords).reduce((s,r)=>s+r.length,0);
    document.getElementById('stat-patients').textContent = patients.length;
    document.getElementById('stat-alerts').textContent = totalAlerts;
    document.getElementById('stat-records').textContent = total;
    document.getElementById('handover-patients').innerHTML = patients.map(p => {
        const recs = allRecords[p.id]||[];
        const ac = recs.reduce((s,r)=>s+(r.alerts?.length||0),0);
        return `<div class="ho-patient"><div class="ho-patient-header"><span class="ho-patient-name">${p.name}（${p.age}歲）${ac>0?' ⚠️':''}</span><span class="ho-patient-bed">${p.bed} | ${p.dx}</span></div><div class="ho-records">${recs.length?recs.map(r=>`<div class="ho-record ${r.alerts?.length?'has-alert':''}"><strong>${r.time}</strong> — Pain: ${r.pain_scale??'-'} | ${r.medications?.map(m=>`${m.name} ${m.dose||''}${m.unit||''}`).join(', ')||'無給藥'}${r.alerts?.length?' ⚠️ 有警示':''}</div>`).join(''):'<div class="ho-record">尚無紀錄</div>'}</div></div>`;
    }).join('');
}

// ══════════════════════════════════════
// 響應式漢堡選單
// ══════════════════════════════════════
function toggleMobileNav() {
    const nav = document.querySelector('.header-nav');
    nav.classList.toggle('nav-open');
}
