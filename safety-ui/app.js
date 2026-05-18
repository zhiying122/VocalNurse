/**
 * VoiceNursy — 完整真實版前端應用程式
 *
 * 本檔案是 VoiceNursy 護理語音紀錄系統的前端主程式，包含：
 *
 * 1. 認證系統（登入/註冊/登出）
 * 2. 病患管理（新增/刪除/選擇病患）
 * 3. 語音錄音（麥克風錄音 → WebM 格式）
 * 4. SOAP 護理紀錄生成（透過後端 LLM）
 * 5. 藥物安全警示（過敏原/劑量異常檢查）
 * 6. 【新增】共享護理紀錄（存檔到後端、從後端載入、跨護理師共享）
 * 7. 交班報告（顯示所有護理師的紀錄摘要）
 * 8. 離線支援（API 失敗時暫存到 IndexedDB）
 * 9. 操作紀錄（Audit Log）
 *
 * 全域變數說明：
 *   authToken      — JWT 認證 token（登入後取得，登出後清空）
 *   currentUser    — 目前登入的護理師資訊 { employee_id, name, role }
 *   currentPatient — 目前選中的病患資訊
 *   currentAlerts  — 目前 SOAP 的安全警示列表
 *   currentOutput  — 目前 LLM 生成的 SOAP 輸出
 *   allRecords     — 所有病患的紀錄快取 { patient_id: [record, ...] }
 *   totalAlerts    — 累計警示數量（用於交班報告統計）
 *   patients       — 所有病患列表（從後端 /patients API 載入）
 */

// 後端 API 基礎 URL（FastAPI 運行在 port 8001）
const API = 'http://localhost:8001';

/**
 * 帶有逾時機制的 fetch 包裝函式。
 * 醫院網路不穩定，需要設定合理的逾時時間避免無限等待。
 *
 * 參數：
 *   url     — API 端點 URL
 *   options — fetch 選項（method, headers, body 等）
 *   timeout — 逾時時間（毫秒），預設 10 秒
 *             SOAP 生成設為 180 秒（LLM 回應較慢）
 *             STT 設為 60 秒
 *
 * 逾時處理：使用 AbortController，超時後自動取消請求
 */
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

// ── 全域狀態變數 ──
let authToken = null;       // JWT 認證 token（登入後賦值）
let currentUser = null;     // 目前登入的護理師 { employee_id, name, role }
let currentPatient = null;  // 目前選中的病患
let currentAlerts = [];     // 目前 SOAP 的安全警示
let currentOutput = null;   // 目前 LLM 生成的 SOAP 輸出
let currentRecordId = null; // 目前已儲存到後端的紀錄 ID（用於編輯功能）
let _tokenRefreshTimer = null; // token 自動刷新計時器
let allRecords = {};        // 所有病患的紀錄快取（key=病患ID, value=紀錄陣列）
let totalAlerts = 0;        // 累計警示數量
let patients = [];          // 所有病患列表

// ══════════════════════════════════════
// 【新增】共用輔助函式
// ══════════════════════════════════════

/**
 * 根據目前時間自動判斷班別。
 * 台灣醫院三班制：
 *   日班   — 08:00 ~ 15:59
 *   小夜班 — 16:00 ~ 23:59
 *   大夜班 — 00:00 ~ 07:59
 *
 * 用途：存檔時自動標記班別，不需要護理師手動選擇
 */
function getCurrentShift() {
    const hour = new Date().getHours();
    if (hour >= 8 && hour < 16) return '日班';
    if (hour >= 16 && hour < 24) return '小夜班';
    return '大夜班';
}

/**
 * 產生帶有 JWT 認證的 HTTP headers。
 * 所有需要驗證的 API 呼叫都要使用此函式。
 *
 * 回傳格式：
 *   {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer eyJhbGciOi...'
 *   }
 */
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

/**
 * 啟動 JWT token 自動刷新（每 7 小時刷新，token 有效期 8 小時）
 */
function startTokenRefresh() {
    stopTokenRefresh();
    _tokenRefreshTimer = setInterval(async () => {
        if (!authToken) return;
        try {
            const res = await fetchWithTimeout(`${API}/auth/refresh`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                authToken = data.token;
                console.log('[Auth] Token 已自動刷新');
            } else if (res.status === 401) {
                showToast('登入已過期，請重新登入');
                stopTokenRefresh();
                doLogout();
            }
        } catch (e) {
            console.warn('[Auth] Token 刷新失敗', e);
        }
    }, 7 * 60 * 60 * 1000); // 7 小時
}

function stopTokenRefresh() {
    if (_tokenRefreshTimer) {
        clearInterval(_tokenRefreshTimer);
        _tokenRefreshTimer = null;
    }
}

// ══════════════════════════════════════
// 工具函式：Loading 狀態 & 表單驗證
// ══════════════════════════════════════
function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
        btn._origText = btn.textContent;
        btn.textContent = '處理中...';
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        if (btn._origText) btn.textContent = btn._origText;
    }
}

function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(inputId + '-error');
    if (input) input.classList.add('input-error');
    if (errorEl) { errorEl.textContent = message; errorEl.classList.add('visible'); }
}

function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(inputId + '-error');
    if (input) input.classList.remove('input-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }
}

function clearAllFieldErrors(ids) {
    ids.forEach(id => clearFieldError(id));
}

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
    clearAllFieldErrors(['reg-id', 'reg-name', 'reg-pw']);

    // 即時驗證
    let hasError = false;
    if (!id) { showFieldError('reg-id', '請輸入員工編號'); hasError = true; }
    if (!name) { showFieldError('reg-name', '請輸入姓名'); hasError = true; }
    if (!pw) { showFieldError('reg-pw', '請輸入密碼'); hasError = true; }
    else if (pw.length < 4) { showFieldError('reg-pw', '密碼至少需要 4 個字元'); hasError = true; }
    if (hasError) return;

    const btn = document.getElementById('register-btn');
    setButtonLoading(btn, true);
    try {
        const res = await fetchWithTimeout(`${API}/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({employee_id:id,password:pw,name}) });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.detail || '註冊失敗'; return; }
        showToast('註冊成功！請登入');
        showLogin();
        document.getElementById('login-id').value = id;
    } catch(e) { err.textContent = e.message === 'API 請求逾時，請檢查網路連線' ? e.message : '無法連線到伺服器'; }
    finally { setButtonLoading(btn, false); }
}

async function doLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value.trim();
    const err = document.getElementById('login-error');
    err.textContent = '';
    clearAllFieldErrors(['login-id', 'login-pw']);

    // 即時驗證
    let hasError = false;
    if (!id) { showFieldError('login-id', '請輸入員工編號'); hasError = true; }
    if (!pw) { showFieldError('login-pw', '請輸入密碼'); hasError = true; }
    if (hasError) return;

    const btn = document.getElementById('login-btn');
    setButtonLoading(btn, true);
    try {
        const res = await fetchWithTimeout(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({employee_id:id,password:pw}) });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.detail || '登入失敗'; return; }
        authToken = data.token; currentUser = data.user;
        startTokenRefresh();
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        document.getElementById('current-nurse').textContent = `護理師：${currentUser.name}`;
        await loadPatients();
        initPainChart();
        initMedicationTimeline();
    } catch(e) { err.textContent = e.message === 'API 請求逾時，請檢查網路連線' ? e.message : '無法連線到伺服器，請確認後端已啟動'; }
    finally { setButtonLoading(btn, false); }
}

/**
 * 登出功能（含確認對話框）
 * 登出前會提示使用者確認，避免誤觸導致未儲存的紀錄遺失。
 */
function doLogout() {
    // 【Item 9】登出確認對話框
    if (!confirm('確定要登出嗎？未儲存的紀錄將會遺失。')) return;
    authToken = null;
    stopTokenRefresh();
    currentUser = null;
    document.getElementById('main-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

// ══════════════════════════════════════
// 病患管理（真實 API）
// ══════════════════════════════════════
async function loadPatients() {
    try {
        const res = await fetchWithTimeout(`${API}/patients`, {
            headers: getAuthHeaders()
        });
        patients = await res.json();
    } catch(e) { patients = []; }
    patients.forEach(p => { if (!allRecords[p.id]) allRecords[p.id] = []; });
    renderPatientList();
    if (patients.length > 0) selectPatient(patients[0].id);
}

function renderPatientList() {
    const el = document.getElementById('patient-list');
    if (!patients.length) { el.innerHTML = '<p style="color:#999;font-size:.85rem">尚無病患，請點「新增病患」</p>'; return; }
    // 按床號排序（字母+數字自然排序）
    const sortedPatients = [...patients].sort((a, b) => a.bed.localeCompare(b.bed, 'zh-TW', { numeric: true }));
    el.innerHTML = sortedPatients.map(p => {
        const ac = (allRecords[p.id]||[]).reduce((s,r) => s + (r.alerts?.length||0), 0);
        return `<div class="patient-chip" id="chip-${p.id}" onclick="selectPatient('${p.id}')">${p.bed} ${p.name}${ac>0?`<span class="chip-alert">⚠${ac}</span>`:''}</div>`;
    }).join('');
}

async function selectPatient(id) {
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
    // 切換病患時清空上一位病患的輸入殘留，避免舊文字被誤送去生成 SOAP
    document.getElementById('transcript-text').value = '';
    document.getElementById('manual-text').value = '';

    // Show loading indicator while fetching records from backend
    const timelineEl = document.getElementById('timeline');
    if (timelineEl) timelineEl.innerHTML = '<p style="color:#999;font-size:.85rem">載入紀錄中...</p>';

    try {
        const res = await fetchWithTimeout(`${API}/records/patient/${id}`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);

        const backendRecords = await res.json();

        // Map backend format to frontend allRecords format
        allRecords[id] = backendRecords.map(r => {
            const createdAt = r.created_at ? new Date(r.created_at) : new Date();
            const time = `${createdAt.getHours().toString().padStart(2,'0')}:${createdAt.getMinutes().toString().padStart(2,'0')}`;
            const date = r.created_at ? r.created_at.slice(0, 10) : createdAt.toISOString().slice(0, 10);
            // 優先使用後端儲存的 alerts 物件陣列，fallback 到 warnings 字串陣列
            const alerts = (r.alerts && r.alerts.length > 0)
                ? r.alerts
                : (r.warnings || []).map(w => typeof w === 'string' ? { message: w, type: '', severity: 'warning', item: '', detected: '', range: '' } : w);
            return {
                id: r.id,
                soap: r.soap,
                medications: r.medications || [],
                pain_scale: r.pain_scale,
                alerts,
                time,
                date,
                raw: r.raw_text || '',
                nurse_name: r.nurse_name || '',
                shift: r.shift || ''
            };
        });
    } catch (e) {
        // Network failure — fall back to IndexedDB records
        console.warn('[selectPatient] 後端載入失敗，使用離線資料', e);
        try {
            if (typeof getPatientRecords === 'function') {
                const localRecords = await getPatientRecords(id);
                if (localRecords && localRecords.length) {
                    allRecords[id] = localRecords.map(r => ({
                        soap: r.soap,
                        medications: r.medications || [],
                        pain_scale: r.pain_scale,
                        alerts: r.alerts || [],
                        time: r.time || '',
                        date: r.date || '',
                        raw: r.raw || '',
                        nurse_name: r.nurse_name || '',
                        shift: r.shift || ''
                    }));
                }
            }
        } catch (_) { /* IndexedDB also failed — keep existing allRecords */ }

        // Show network error indicator
        if (timelineEl) {
            const errorIndicator = document.createElement('div');
            errorIndicator.className = 'net-error-indicator';
            errorIndicator.style.cssText = 'color:#c62828;font-size:.8rem;padding:4px 8px;margin-bottom:4px;';
            errorIndicator.textContent = '⚠ 網路錯誤，顯示離線資料';
            timelineEl.prepend(errorIndicator);
        }
    }

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

    // 表單驗證
    let hasError = false;
    if (!name) {
        const el = document.getElementById('pt-name');
        if (el) el.classList.add('input-error');
        hasError = true;
    }
    if (!bed) {
        const el = document.getElementById('pt-bed');
        if (el) el.classList.add('input-error');
        hasError = true;
    }
    if (hasError) { showToast('請至少填寫姓名和床號'); return; }

    const btn = document.getElementById('submit-patient-btn');
    setButtonLoading(btn, true);
    try {
        const res = await fetchWithTimeout(`${API}/patients`, { method:'POST', headers: getAuthHeaders(), body:JSON.stringify({name,bed,dx,age,allergies}) });
        if (!res.ok) throw new Error('新增失敗');
        hideAddPatient();
        ['pt-name','pt-bed','pt-age','pt-dx','pt-allergies','pt-note'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('input-error'); }
        });
        await loadPatients();
        showToast(`✓ 已成功新增病患「${name}」`);
    } catch(e) { showToast('新增病患失敗：' + e.message); }
    finally { setButtonLoading(btn, false); }
}

async function removePatient() {
    if (!currentPatient || !confirm(`確定移除 ${currentPatient.name}？`)) return;
    try {
        await fetchWithTimeout(`${API}/patients/${currentPatient.id}`, { method:'DELETE', headers: getAuthHeaders() });
        currentPatient = null;
        document.getElementById('patient-info').classList.add('hidden');
        document.getElementById('main-area').style.display = 'none';
        await loadPatients();
    } catch(e) { alert('移除失敗'); }
}

// ══════════════════════════════════════
// 病患資料編輯
// ══════════════════════════════════════

/**
 * 顯示病患編輯表單（預填現有資料）
 */
function showEditPatient() {
    if (!currentPatient) return;
    // 預填現有資料
    document.getElementById('edit-pt-name').value = currentPatient.name || '';
    document.getElementById('edit-pt-bed').value = currentPatient.bed || '';
    document.getElementById('edit-pt-age').value = currentPatient.age || '';
    document.getElementById('edit-pt-dx').value = currentPatient.dx || '';
    document.getElementById('edit-pt-allergies').value = (currentPatient.allergies || []).join(', ');
    document.getElementById('edit-patient-form').classList.remove('hidden');
}

function hideEditPatient() {
    document.getElementById('edit-patient-form').classList.add('hidden');
}

async function submitEditPatient() {
    if (!currentPatient) return;
    const name = document.getElementById('edit-pt-name').value.trim();
    const bed = document.getElementById('edit-pt-bed').value.trim();
    const age = parseInt(document.getElementById('edit-pt-age').value) || currentPatient.age;
    const dx = document.getElementById('edit-pt-dx').value.trim();
    const allergiesStr = document.getElementById('edit-pt-allergies').value.trim();
    const allergies = allergiesStr ? allergiesStr.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];

    const updates = {};
    if (name) updates.name = name;
    if (bed) updates.bed = bed;
    if (age) updates.age = age;
    if (dx !== undefined) updates.dx = dx;
    updates.allergies = allergies;

    const btn = document.getElementById('submit-edit-patient-btn');
    setButtonLoading(btn, true);
    try {
        const res = await fetchWithTimeout(`${API}/patients/${currentPatient.id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error('更新失敗');
        const updated = await res.json();
        // 更新本地 patients 陣列
        const idx = patients.findIndex(p => p.id === currentPatient.id);
        if (idx !== -1) patients[idx] = updated;
        currentPatient = updated;
        hideEditPatient();
        // 重新渲染病患資訊
        document.getElementById('patient-name').textContent = `${updated.name}（${updated.age}歲）`;
        document.getElementById('patient-bed').textContent = updated.bed;
        document.getElementById('patient-dx').innerHTML = updated.dx +
            (updated.allergies?.length ? ' ' + updated.allergies.map(a => `<span class="allergy-tag">⚠ ${a} 過敏</span>`).join(' ') : '');
        renderPatientList();
        showToast(`✓ 病患資料已更新`);
    } catch (e) {
        showToast('更新失敗：' + e.message);
    } finally {
        setButtonLoading(btn, false);
    }
}

// ══════════════════════════════════════
// 錄音（點一下開始，再點一下停止）
// ══════════════════════════════════════
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;
let isRecording = false;
let isPaused = false;  // 【Item 14】錄音暫停狀態

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

/**
 * 【Item 14】暫停/恢復錄音
 * 使用 MediaRecorder 的 pause() 和 resume() API
 */
function togglePauseRecording() {
    if (!mediaRecorder || !isRecording) return;

    const pauseBtn = document.getElementById('pause-btn');
    if (isPaused) {
        // 恢復錄音
        mediaRecorder.resume();
        isPaused = false;
        if (pauseBtn) pauseBtn.textContent = '⏸ 暫停';
        document.getElementById('record-btn').classList.add('recording');
        // 恢復計時器
        recordTimer = setInterval(() => {
            recordSeconds++;
            document.getElementById('record-timer').textContent = `${recordSeconds}s`;
        }, 1000);
        document.querySelector('#recording-indicator span').innerHTML =
            `錄音中... <span id="record-timer">${recordSeconds}s</span>（再點一下停止）`;
    } else {
        // 暫停錄音
        mediaRecorder.pause();
        isPaused = true;
        if (pauseBtn) pauseBtn.textContent = '▶ 繼續';
        document.getElementById('record-btn').classList.remove('recording');
        clearInterval(recordTimer);
        document.querySelector('#recording-indicator span').innerHTML =
            `已暫停 <span id="record-timer">${recordSeconds}s</span>（點繼續恢復錄音）`;
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
        isPaused = false;
        recordSeconds = 0;
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('record-label').textContent = '點擊停止錄音';
        document.getElementById('recording-indicator').classList.remove('hidden');
        // 顯示暫停按鈕
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) { pauseBtn.classList.remove('hidden'); pauseBtn.textContent = '⏸ 暫停'; }
        recordTimer = setInterval(() => { recordSeconds++; document.getElementById('record-timer').textContent = `${recordSeconds}s`; }, 1000);
    } catch(e) { alert('無法存取麥克風：' + e.message); }
}

function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        mediaRecorder.stop();
        clearInterval(recordTimer);
        isRecording = false;
        isPaused = false;
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('record-label').textContent = '點擊開始錄音';
        document.getElementById('recording-indicator').classList.add('hidden');
        // 隱藏暫停按鈕
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) pauseBtn.classList.add('hidden');
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
            const res = await fetchWithTimeout(`${API}/pipeline/full`, { method:'POST', body: fd }, 180000);
            if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
            const data = await res.json();
            document.getElementById('processing').classList.add('hidden');
            // 顯示轉錄結果
            document.getElementById('transcript-text').value = data.stt.cleaned_text;
            document.getElementById('transcript-area').classList.remove('hidden');
            // 直接顯示 SOAP
            currentOutput = data.brain;
            currentAlerts = checkSafety(data.brain, allRecords[currentPatient.id] || []);
            currentRecordId = null; // 新生成的 SOAP 尚未儲存
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
            const res = await fetchWithTimeout(`${API}/stt/transcribe`, { method:'POST', body: fd }, 60000);
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
        const res = await fetchWithTimeout(`${API}/brain/process`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({raw_text:rawText}) }, 180000);
        if (!res.ok) throw new Error(`${res.status}`);
        const output = await res.json();
        currentOutput = output;
        currentAlerts = checkSafety(output, allRecords[currentPatient.id] || []);
        currentRecordId = null; // 新生成的 SOAP 尚未儲存，重置 ID
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
    // 為每個 SOAP 欄位加入字數提示
    ['soap-s', 'soap-o', 'soap-a', 'soap-p'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        // 移除舊的字數提示
        const oldCounter = el.parentNode.querySelector('.char-counter');
        if (oldCounter) oldCounter.remove();
        // 建立字數提示
        const counter = document.createElement('div');
        counter.className = 'char-counter';
        counter.style.cssText = 'font-size:.72rem;color:var(--text-muted);text-align:right;margin-top:2px;';
        const updateCounter = () => {
            const len = el.textContent.length;
            counter.textContent = `${len} / 5000`;
            counter.style.color = len > 4500 ? '#c62828' : len > 4000 ? '#f57c00' : 'var(--text-muted)';
        };
        updateCounter();
        el.addEventListener('input', updateCounter);
        el.parentNode.appendChild(counter);
    });
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
    document.getElementById('alert-title').textContent = a.type === 'allergy' ? '過敏原警示' : '劑量異常警示';
    document.getElementById('alert-msg').textContent = a.message;
    document.getElementById('alert-val').textContent = a.detected;
    document.getElementById('alert-range').textContent = a.range;
    document.getElementById('alert-overlay').classList.remove('hidden');
    // 使用共享的 AudioContext，避免每次建立新的被瀏覽器封鎖
    try {
        if (!window._audioCtx || window._audioCtx.state === 'closed') {
            window._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (window._audioCtx.state === 'suspended') {
            window._audioCtx.resume();
        }
        const o = window._audioCtx.createOscillator();
        const g = window._audioCtx.createGain();
        o.connect(g);
        g.connect(window._audioCtx.destination);
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.4, window._audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, window._audioCtx.currentTime + 0.5);
        o.start();
        o.stop(window._audioCtx.currentTime + 0.5);
    } catch(e) { console.warn('[Alert] 音效播放失敗', e); }
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
async function confirmSave() {
    if (!currentOutput || !currentPatient) return;

    // Disable save button to prevent double-submit
    const saveBtn = document.querySelector('.confirm-area .btn-success');
    if (saveBtn) saveBtn.disabled = true;

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    // Build record payload for backend
    const payload = {
        patient_id: currentPatient.id,
        soap: currentOutput.soap,
        medications: currentOutput.medications,
        pain_scale: currentOutput.pain_scale,
        warnings: currentAlerts.map(a => a.message || ''),
        raw_text: currentOutput.raw_text || '',
        shift: getCurrentShift(),
        alerts: currentAlerts.map(a => ({
            type: a.type || '',
            severity: a.severity || '',
            item: a.item || '',
            detected: a.detected || '',
            range: a.range || '',
            message: a.message || ''
        }))
    };

    try {
        const res = await fetchWithTimeout(`${API}/records`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (res.status === 401) {
            showToast('登入已過期，請重新登入');
            doLogout();
            return;
        }

        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);

        const savedRecord = await res.json();

        // Update local records with backend response
        if (!allRecords[currentPatient.id]) allRecords[currentPatient.id] = [];
        allRecords[currentPatient.id].push({
            id: savedRecord.id,
            soap: savedRecord.soap,
            medications: savedRecord.medications || [],
            pain_scale: savedRecord.pain_scale,
            alerts: currentAlerts,
            time,
            date: now.toISOString().slice(0, 10),
            raw: savedRecord.raw_text || '',
            nurse_name: savedRecord.nurse_name || '',
            shift: savedRecord.shift || ''
        });
        currentRecordId = savedRecord.id; // 記錄剛儲存的紀錄 ID，供編輯功能使用
        totalAlerts += currentAlerts.length;

        showToast('✓ 紀錄已儲存');
    } catch (e) {
        // Network failure — save to IndexedDB offline
        if (typeof saveRecordLocally === 'function') {
            try {
                await saveRecordLocally({
                    patientId: currentPatient.id,
                    patientName: currentPatient.name,
                    soap: currentOutput.soap,
                    medications: currentOutput.medications,
                    pain_scale: currentOutput.pain_scale,
                    alerts: currentAlerts,
                    time,
                    date: now.toISOString().slice(0, 10),
                    raw: currentOutput.raw_text,
                    nurse_id: currentUser?.employee_id || '',
                    nurse_name: currentUser?.name || '',
                    shift: getCurrentShift(),
                    synced: false
                });
            } catch (_) { /* IndexedDB failure — continue with in-memory save */ }
        }

        // Also keep in-memory record so UI stays consistent
        if (!allRecords[currentPatient.id]) allRecords[currentPatient.id] = [];
        allRecords[currentPatient.id].push({
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: currentOutput.pain_scale,
            alerts: currentAlerts,
            time,
            date: now.toISOString().slice(0, 10),
            raw: currentOutput.raw_text
        });
        totalAlerts += currentAlerts.length;

        showToast('已離線暫存');
    }

    // Remove any existing save-fail prompt
    const failDiv = document.getElementById('save-fail');
    if (failDiv) failDiv.remove();

    // Show success animation & update UI
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
            time,
            date: now.toISOString().slice(0, 10),
            raw: currentOutput.raw_text || '',
            nurse_id: currentUser?.employee_id || '',
            nurse_name: currentUser?.name || '',
            shift: getCurrentShift(),
            synced: false
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
    if (!records.length) { el.innerHTML = '<p style="color:#999;font-size:.85rem">尚無紀錄</p>'; return; }
    el.innerHTML = [...records].reverse().map((r, idx) => {
        const realIdx = records.length - 1 - idx; // 對應原始陣列的索引
        const d = r.alerts?.length > 0;
        const meds = r.medications?.map(m => `${m.name} ${m.dose || ''} ${m.unit || ''}`).join(', ') || '';
        const nurseLabel = r.nurse_name ? ` [${r.nurse_name}]` : '';
        const shiftLabel = r.shift ? ` ${r.shift}` : '';
        const isOwner = r.nurse_name === currentUser?.name || !r.nurse_name;
        const actionBtns = isOwner && r.id ? `
            <div class="tl-actions">
                <button class="btn btn-small btn-outline" onclick="editHistoryRecord('${r.id}', ${realIdx})" style="font-size:.75rem;padding:2px 8px">✏️ 編輯</button>
                <button class="btn btn-small" onclick="deleteHistoryRecord('${r.id}', ${realIdx})" style="font-size:.75rem;padding:2px 8px;color:var(--danger);border-color:var(--danger)">🗑️ 刪除</button>
            </div>` : '';
        return `<div class="tl-item ${d ? 'danger' : ''}" onclick="toggleTimelineDetail(this)">
            <div class="tl-summary">
                <span class="tl-time">${r.time}${nurseLabel}${shiftLabel}</span>
                <span>${meds || r.soap?.plan || '護理紀錄'}${d ? ' ⚠️' : ''}</span>
            </div>
            <div class="tl-detail hidden">
                <div class="tl-soap"><strong>S：</strong>${r.soap?.subjective || '-'}</div>
                <div class="tl-soap"><strong>O：</strong>${r.soap?.objective || '-'}</div>
                <div class="tl-soap"><strong>A：</strong>${r.soap?.assessment || '-'}</div>
                <div class="tl-soap"><strong>P：</strong>${r.soap?.plan || '-'}</div>
                ${actionBtns}
            </div>
        </div>`;
    }).join('');
}

function toggleTimelineDetail(el) {
    const detail = el.querySelector('.tl-detail');
    if (detail) detail.classList.toggle('hidden');
}

/**
 * 展開/收合交班報告中的 SOAP 詳細內容。
 * renderHandover() 產生的每筆紀錄 div 都有 onclick="toggleHoSoap(this)"，
 * 點擊後切換 .ho-soap-detail 的 hidden class，顯示或隱藏 SOAP 四欄位。
 * 同時更新展開提示文字（▼ 展開 SOAP ↔ ▲ 收合 SOAP）。
 */
function toggleHoSoap(el) {
    const detail = el.querySelector('.ho-soap-detail');
    if (!detail) return;
    const isHidden = detail.classList.toggle('hidden');
    const hint = el.querySelector('.ho-expand-hint');
    if (hint) hint.textContent = isHidden ? '▼ 展開 SOAP' : '▲ 收合 SOAP';
}

async function editHistoryRecord(recordId, recordIdx) {
    const record = (allRecords[currentPatient.id] || [])[recordIdx];
    if (!record) return;

    // 將歷史紀錄載入到 SOAP 卡片進行編輯
    currentOutput = { soap: record.soap, medications: record.medications || [], pain_scale: record.pain_scale, raw_text: record.raw || '' };
    currentRecordId = recordId;
    displaySOAP(currentOutput);
    document.getElementById('soap-cards').classList.remove('hidden');
    document.getElementById('save-ok').classList.add('hidden');

    // 切換到編輯模式
    enableRecordEdit();
    showToast('已載入紀錄，請編輯後點「儲存修改」');
    // 捲動到 SOAP 卡片
    document.getElementById('soap-cards').scrollIntoView({ behavior: 'smooth' });
}

async function deleteHistoryRecord(recordId, recordIdx) {
    if (!confirm('確定刪除這筆紀錄？此操作無法復原。')) return;
    try {
        const res = await fetchWithTimeout(`${API}/records/${recordId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (res.status === 403) { showToast('無權限刪除他人建立的紀錄'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 從本地快取移除
        if (allRecords[currentPatient.id]) {
            allRecords[currentPatient.id].splice(recordIdx, 1);
        }
        renderTimeline();
        updatePainChart();
        renderPatientList();
        showToast('✓ 紀錄已刪除');
    } catch (e) {
        showToast('刪除失敗：' + e.message);
    }
}

/**
 * 【慈悲科技】產生關懷提醒
 * 根據病患的紀錄分析，產生有溫度的關懷建議。
 * 這不只是數據分析，而是提醒護理師關注病患的身心狀態。
 */
function generateCareReminders(patientRecords, patient) {
    const reminders = [];
    const records = patientRecords || [];
    
    if (!records.length) return reminders;

    // 連續高疼痛指數提醒
    const recentPain = records.slice(-3).filter(r => r.pain_scale != null && r.pain_scale >= 7);
    if (recentPain.length >= 2) {
        reminders.push({
            icon: '💛',
            text: `${patient.name} 近期疼痛指數持續偏高（≥7），建議加強疼痛評估與關懷，了解是否有未被滿足的需求。`
        });
    }

    // 多次警示提醒
    const totalAlertCount = records.reduce((sum, r) => sum + (r.alerts?.length || 0), 0);
    if (totalAlertCount >= 3) {
        reminders.push({
            icon: '🔔',
            text: `${patient.name} 已累積 ${totalAlertCount} 次安全警示，建議與醫師討論用藥方案是否需要調整。`
        });
    }

    // 長時間未有紀錄提醒
    if (records.length > 0) {
        const lastRecord = records[records.length - 1];
        const lastTime = lastRecord.time || '';
        const now = new Date();
        const currentHour = now.getHours();
        const lastHour = parseInt(lastTime.split(':')[0]) || 0;
        if (currentHour - lastHour >= 4 && currentHour - lastHour < 12) {
            reminders.push({
                icon: '🕐',
                text: `${patient.name} 已超過 4 小時未有新紀錄，建議前往巡視確認病患狀況。`
            });
        }
    }

    return reminders;
}

async function renderHandover() {
    let handoverRecords = allRecords; // fallback: use local data
    let showWarning = false;

    try {
        const res = await fetchWithTimeout(`${API}/records`, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
        const data = await res.json();
        // 【Item 13】支援分頁格式：後端回傳 { records: [...], total, page, ... }
        const backendRecords = Array.isArray(data) ? data : (data.records || []);

        // Group backend records by patient_id
        const grouped = {};
        backendRecords.forEach(r => {
            if (!grouped[r.patient_id]) grouped[r.patient_id] = [];
            const createdAt = r.created_at ? new Date(r.created_at) : new Date();
            const time = `${createdAt.getHours().toString().padStart(2,'0')}:${createdAt.getMinutes().toString().padStart(2,'0')}`;
            grouped[r.patient_id].push({
                soap: r.soap,
                medications: r.medications || [],
                pain_scale: r.pain_scale,
                alerts: (r.alerts && r.alerts.length)
                    ? r.alerts
                    : (r.warnings || []).map(w => typeof w === 'string' ? { message: w } : w),
                time,
                date: r.created_at ? r.created_at.slice(0, 10) : createdAt.toISOString().slice(0, 10),
                raw: r.raw_text || '',
                nurse_name: r.nurse_name || '',
                shift: r.shift || ''
            });
        });
        handoverRecords = grouped;
    } catch (e) {
        console.warn('[renderHandover] 後端載入失敗，使用本地資料', e);
        showWarning = true;
    }

    const total = Object.values(handoverRecords).reduce((s,r)=>s+r.length,0);
    // 從實際載入的紀錄計算警示數，比全域 totalAlerts 更準確
    const actualAlerts = Object.values(handoverRecords).reduce(
        (sum, recs) => sum + recs.reduce((s, r) => s + (r.alerts?.length || 0), 0), 0
    );
    document.getElementById('stat-patients').textContent = patients.length;
    document.getElementById('stat-alerts').textContent = actualAlerts;
    document.getElementById('stat-records').textContent = total;

    const warningHtml = showWarning ? '<div class="ho-warning">⚠ 資料可能不完整（網路錯誤）</div>' : '';

    document.getElementById('handover-patients').innerHTML = warningHtml + patients.map(p => {
        const recs = handoverRecords[p.id]||[];
        const ac = recs.reduce((s,r)=>s+(r.alerts?.length||0),0);
        return `<div class="ho-patient"><div class="ho-patient-header"><span class="ho-patient-name">${p.name}（${p.age}歲）${ac>0?' ⚠️':''}</span><span class="ho-patient-bed">${p.bed} | ${p.dx}</span></div><div class="ho-records">${recs.length?recs.map(r=>{
            const nurseInfo = r.nurse_name ? ` — 護理師：${r.nurse_name}` : '';
            const shiftInfo = r.shift ? `【${r.shift}】` : '';
            const soapHtml = r.soap ? `
    <div class="ho-soap-detail hidden">
        <div><strong>S：</strong>${r.soap.subjective || '-'}</div>
        <div><strong>O：</strong>${r.soap.objective || '-'}</div>
        <div><strong>A：</strong>${r.soap.assessment || '-'}</div>
        <div><strong>P：</strong>${r.soap.plan || '-'}</div>
    </div>` : '';
            return `<div class="ho-record ${r.alerts?.length?'has-alert':''}" onclick="toggleHoSoap(this)" style="cursor:pointer">
    <div class="ho-record-summary">
        <strong>${r.time}</strong>${nurseInfo} ${shiftInfo} — Pain: ${r.pain_scale??'-'} | ${r.medications?.map(m=>`${m.name} ${m.dose||''}${m.unit||''}`).join(', ')||'無給藥'}${r.alerts?.length?' ⚠️ 有警示':''}
        <span class="ho-expand-hint" style="color:var(--text-muted);font-size:.75rem;margin-left:6px">▼ 展開 SOAP</span>
    </div>
    ${soapHtml}
</div>`;
        }).join(''):'<div class="ho-record">尚無紀錄</div>'}</div></div>`;
    }).join('');

    // 【慈悲科技】產生並顯示關懷提醒
    let careHtml = '';
    patients.forEach(p => {
        const recs = handoverRecords[p.id] || [];
        const reminders = generateCareReminders(recs, p);
        if (reminders.length > 0) {
            careHtml += reminders.map(r => 
                `<div class="care-reminder"><span class="care-reminder-icon">${r.icon}</span><div class="care-reminder-content">${r.text}</div></div>`
            ).join('');
        }
    });
    
    if (careHtml) {
        const careSection = `<div style="margin-bottom:20px"><h3 style="font-size:.95rem;color:var(--warning);margin-bottom:12px">💝 關懷提醒</h3>${careHtml}</div>`;
        const handoverEl = document.getElementById('handover-patients');
        handoverEl.innerHTML = careSection + handoverEl.innerHTML;
    }
}

// ══════════════════════════════════════
// 響應式漢堡選單
// ══════════════════════════════════════
function toggleMobileNav() {
    const nav = document.querySelector('.header-nav');
    const btn = document.querySelector('.hamburger-btn');
    nav.classList.toggle('nav-open');
    const isOpen = nav.classList.contains('nav-open');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

// ══════════════════════════════════════
// 即時時鐘
// ══════════════════════════════════════
function updateClock() {
    const el = document.getElementById('header-clock');
    if (!el) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const h = now.getHours().toString().padStart(2, '0');
    const min = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    el.textContent = `${y}/${m}/${d} ${h}:${min}:${s}`;

    // 自動偵測班別
    const shiftEl = document.getElementById('current-shift');
    if (shiftEl) {
        const hour = now.getHours();
        let shiftText;
        if (hour >= 8 && hour < 16) shiftText = '日班';
        else if (hour >= 16 && hour < 24) shiftText = '小夜班';
        else shiftText = '大夜班';
        shiftEl.textContent = shiftText;
    }
}
setInterval(updateClock, 1000);
updateClock();

// ══════════════════════════════════════
// 操作紀錄 (Audit Log)
// ══════════════════════════════════════
let auditLogs = [];

function addAuditLog(action, detail) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    const nurse = currentUser ? currentUser.name : '未知';
    auditLogs.unshift({ timestamp, nurse, action, detail });
    renderAuditLog();
}

function renderAuditLog() {
    const el = document.getElementById('audit-log');
    const countEl = document.getElementById('audit-count');
    if (!el) return;
    if (countEl) countEl.textContent = `${auditLogs.length} 筆`;
    if (!auditLogs.length) {
        el.innerHTML = '<div class="audit-empty">尚無操作紀錄</div>';
        return;
    }
    el.innerHTML = auditLogs.slice(0, 50).map(log =>
        `<div class="audit-item"><span class="audit-time">${log.timestamp}</span><span class="audit-nurse">${log.nurse}</span><span class="audit-action">${log.action}</span><span class="audit-detail">${log.detail}</span></div>`
    ).join('');
}

// Hook into existing functions to log actions
const _origConfirmSave = confirmSave;
confirmSave = async function() {
    await _origConfirmSave();
    if (currentPatient && currentOutput) {
        const meds = currentOutput.medications?.map(m => m.name).join(', ') || '無';
        addAuditLog('存檔 SOAP', `病患：${currentPatient.name} | 藥物：${meds}`);
    }
};

const _origDoLogin = doLogin;
doLogin = async function() {
    await _origDoLogin();
    if (currentUser) {
        addAuditLog('登入系統', `員工：${currentUser.name}`);
    }
};

const _origSubmitPatient = submitPatient;
submitPatient = async function() {
    const name = document.getElementById('pt-name').value.trim();
    const bed = document.getElementById('pt-bed').value.trim();
    await _origSubmitPatient();
    if (name && bed) {
        addAuditLog('新增病患', `${name}（${bed}）`);
    }
};

const _origRemovePatient = removePatient;
removePatient = async function() {
    const name = currentPatient?.name || '';
    const bed = currentPatient?.bed || '';
    await _origRemovePatient();
    if (name) {
        addAuditLog('移除病患', `${name}（${bed}）`);
    }
};

/* ── Toast 通知 ── */
function showToast(message, duration = 2500) {
    const el = document.createElement('div');
    el.className = 'toast-notify';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        el.addEventListener('transitionend', () => el.remove());
    }, duration);
}

// ══════════════════════════════════════
// 即時表單驗證 (blur 事件)
// ══════════════════════════════════════
function setupFieldValidation(inputId, validator) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('blur', () => {
        const val = input.value.trim();
        const error = validator(val);
        if (error) showFieldError(inputId, error);
        else clearFieldError(inputId);
    });
    input.addEventListener('input', () => {
        // 使用者開始輸入時清除錯誤
        clearFieldError(inputId);
        input.classList.remove('input-error');
    });
}

// 初始化即時驗證
document.addEventListener('DOMContentLoaded', () => {
    // 登入表單驗證
    setupFieldValidation('login-id', v => !v ? '請輸入員工編號' : '');
    setupFieldValidation('login-pw', v => !v ? '請輸入密碼' : '');

    // 註冊表單驗證
    setupFieldValidation('reg-id', v => !v ? '請輸入員工編號' : '');
    setupFieldValidation('reg-name', v => !v ? '請輸入姓名' : '');
    setupFieldValidation('reg-pw', v => {
        if (!v) return '請輸入密碼';
        if (v.length < 4) return '密碼至少需要 4 個字元';
        return '';
    });

    // 新增病患表單 — input 事件清除錯誤
    ['pt-name', 'pt-bed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => el.classList.remove('input-error'));
    });

    // 手動輸入區 Enter 鍵送出 (Ctrl+Enter 或 Cmd+Enter)
    const manualText = document.getElementById('manual-text');
    if (manualText) {
        manualText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendManualText();
            }
        });
    }

    // 轉錄結果區 Enter 鍵送出
    const transcriptText = document.getElementById('transcript-text');
    if (transcriptText) {
        transcriptText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendToBrain();
            }
        });
    }
});

// ══════════════════════════════════════
// 【Item 15】病患搜尋功能
// ══════════════════════════════════════

/**
 * 搜尋病患列表。
 * 比對病患姓名、床號、診斷，支援模糊搜尋。
 *
 * 參數：
 *   query — 搜尋關鍵字（從搜尋輸入框取得）
 */
function searchPatients(query) {
    const q = (query || '').trim().toLowerCase();
    const el = document.getElementById('patient-list');

    if (!q) {
        // 搜尋框為空，顯示所有病患
        renderPatientList();
        return;
    }

    // 篩選符合條件的病患（姓名、床號、診斷）
    const filtered = patients.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.bed.toLowerCase().includes(q) ||
        (p.dx || '').toLowerCase().includes(q)
    );

    if (!filtered.length) {
        el.innerHTML = '<p style="color:#999;font-size:.85rem">找不到符合的病患</p>';
        return;
    }

    el.innerHTML = filtered.map(p => {
        const ac = (allRecords[p.id] || []).reduce((s, r) => s + (r.alerts?.length || 0), 0);
        return `<div class="patient-chip" id="chip-${p.id}" onclick="selectPatient('${p.id}')">${p.bed} ${p.name}${ac > 0 ? `<span class="chip-alert">⚠${ac}</span>` : ''}</div>`;
    }).join('');
}


// ══════════════════════════════════════
// 【Item 11】列印交班報告
// ══════════════════════════════════════

/**
 * 列印交班報告。
 * 使用 window.print() 搭配 @media print CSS 樣式，
 * 只印出交班報告內容，隱藏導覽列和側邊欄。
 */
function printHandover() {
    // 確保交班頁面已渲染
    switchTab('handover');
    // 延遲一小段時間讓頁面渲染完成
    setTimeout(() => {
        window.print();
    }, 300);
}


// ══════════════════════════════════════
// 【Item 12】紀錄編輯功能
// ══════════════════════════════════════

/**
 * 啟用 SOAP 卡片的編輯模式。
 * 將 SOAP 內容區域切換為可編輯的 textarea，
 * 並顯示「儲存修改」按鈕。
 */
function enableRecordEdit() {
    const fields = ['soap-s', 'soap-o', 'soap-a', 'soap-p'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.setAttribute('contenteditable', 'true');
            el.classList.add('editing');
            el.style.border = '1px dashed var(--accent)';
            el.style.padding = '8px';
        }
    });

    // 顯示儲存修改按鈕，隱藏編輯按鈕
    const editBtn = document.getElementById('edit-record-btn');
    const saveEditBtn = document.getElementById('save-edit-btn');
    if (editBtn) editBtn.classList.add('hidden');
    if (saveEditBtn) saveEditBtn.classList.remove('hidden');
}

/**
 * 儲存 SOAP 紀錄的修改。
 * 從 contenteditable 區域讀取修改後的內容，
 * 透過 PUT /records/{record_id} API 更新後端。
 */
async function saveRecordEdit() {
    if (!currentOutput || !currentPatient) return;

    // 讀取修改後的 SOAP 內容
    const updatedSoap = {
        subjective: document.getElementById('soap-s').textContent.trim(),
        objective: document.getElementById('soap-o').textContent.trim(),
        assessment: document.getElementById('soap-a').textContent.trim(),
        plan: document.getElementById('soap-p').textContent.trim(),
    };

    // 更新本地 currentOutput
    currentOutput.soap = updatedSoap;

    // 如果有紀錄 ID（已儲存到後端的紀錄），透過 API 更新
    if (currentRecordId) {
        try {
            const res = await fetchWithTimeout(`${API}/records/${currentRecordId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ soap: updatedSoap }),
            });
            if (res.ok) {
                showToast('✓ 紀錄已更新');
            } else {
                const errData = await res.json().catch(() => ({}));
                showToast('更新失敗：' + (errData.detail || `HTTP ${res.status}`));
            }
        } catch (e) {
            showToast('更新失敗：網路錯誤');
        }
    } else {
        // 尚未儲存到後端（離線紀錄），只更新本地 currentOutput
        showToast('✓ 已更新（離線模式）');
    }

    // 恢復為非編輯模式
    const fields = ['soap-s', 'soap-o', 'soap-a', 'soap-p'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('editing');
            el.style.border = '';
            el.style.padding = '';
        }
    });

    // 切換按鈕顯示
    const editBtn = document.getElementById('edit-record-btn');
    const saveEditBtn = document.getElementById('save-edit-btn');
    if (editBtn) editBtn.classList.remove('hidden');
    if (saveEditBtn) saveEditBtn.classList.add('hidden');
}
