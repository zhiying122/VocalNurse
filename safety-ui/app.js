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
    if (tab==='handover') {
        renderHandover();
        loadWorkload();
        loadTeamStress();
    }
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
const AUDIT_LOG_STORAGE_KEY = 'voicenursy_audit_logs';
let auditLogs = [];

function addAuditLog(action, detail) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    const nurse = currentUser ? currentUser.name : '未知';
    auditLogs.unshift({ timestamp, nurse, action, detail });
    // 【修復】持久化寫入 localStorage，只保留最新 1000 筆避免超出 5MB 限制
    try {
        const toStore = auditLogs.slice(0, 1000);
        localStorage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(toStore));
    } catch (e) {
        console.warn('[AuditLog] localStorage 寫入失敗', e);
    }
    renderAuditLog();
}

function loadAuditLogs() {
    try {
        const stored = localStorage.getItem(AUDIT_LOG_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                auditLogs = parsed;
            }
        }
    } catch (e) {
        console.warn('[AuditLog] localStorage 讀取失敗', e);
        auditLogs = [];
    }
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
    const patientSnapshot = currentPatient ? { ...currentPatient } : null;
    const outputSnapshot = currentOutput ? { ...currentOutput } : null;
    await _origConfirmSave();
    if (currentPatient && currentOutput) {
        const meds = currentOutput.medications?.map(m => m.name).join(', ') || '無';
        addAuditLog('存檔 SOAP', `病患：${currentPatient.name} | 藥物：${meds}`);
    }
    // 存檔成功後排程給藥提醒
    if (patientSnapshot && outputSnapshot?.soap?.plan && outputSnapshot?.medications?.length) {
        scheduleMedicationReminders(patientSnapshot, outputSnapshot.soap, outputSnapshot.medications);
    }
};

const _origDoLogin = doLogin;
doLogin = async function() {
    await _origDoLogin();
    if (currentUser) {
        loadAuditLogs();  // 【修復】先從 localStorage 還原歷史紀錄
        addAuditLog('登入系統', `員工：${currentUser.name}`);
        // 請求通知權限（給藥提醒用）
        await requestNotificationPermission();
        // 延遲 3 秒後分析壓力狀態（避免影響登入體驗）
        setTimeout(checkSelfStress, 3000);
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

// ══════════════════════════════════════
// 護理師工作負荷儀表板
// ══════════════════════════════════════

let workloadChart = null;

/**
 * 初始化日期選擇器為今天，並載入工作負荷資料。
 */
function initWorkloadDate() {
    const dateInput = document.getElementById('workload-date');
    if (!dateInput) return;
    const today = new Date().toISOString().slice(0, 10);
    dateInput.value = today;
}

/**
 * 從後端 /workload API 載入護理師工作負荷資料，
 * 並呼叫 renderWorkload() 渲染卡片和圖表。
 */
async function loadWorkload() {
    const dateInput = document.getElementById('workload-date');
    const date = dateInput?.value || new Date().toISOString().slice(0, 10);

    const cardsEl = document.getElementById('workload-cards');
    if (cardsEl) cardsEl.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">載入中...</p>';

    try {
        const res = await fetchWithTimeout(`${API}/workload?date=${date}`, {
            method: 'GET',
            headers: getAuthHeaders()
        });
        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
        const data = await res.json();
        renderWorkload(data);
    } catch (e) {
        if (cardsEl) cardsEl.innerHTML = `<p style="color:var(--danger);font-size:.85rem">⚠ 載入失敗：${e.message}</p>`;
        console.warn('[Workload] 載入失敗', e);
    }
}

/**
 * 渲染護理師工作負荷卡片和長條圖。
 *
 * 負荷等級對應顏色：
 *   low      — 綠色（輕鬆）
 *   medium   — 黃色（中等）
 *   high     — 橙色（高負荷）
 *   overload — 紅色（過載）
 *
 * @param {Object} data — 後端 /workload 回傳的資料
 */
function renderWorkload(data) {
    const nurses = data.nurses || [];
    const cardsEl = document.getElementById('workload-cards');
    if (!cardsEl) return;

    const LEVEL_COLOR = {
        low:      { bg: 'rgba(56,142,60,.12)',  border: '#388e3c', text: '#388e3c', label: '輕鬆' },
        medium:   { bg: 'rgba(245,124,0,.12)',  border: '#f57c00', text: '#f57c00', label: '中等' },
        high:     { bg: 'rgba(230,81,0,.12)',   border: '#e65100', text: '#e65100', label: '高負荷' },
        overload: { bg: 'rgba(198,40,40,.12)',  border: '#c62828', text: '#c62828', label: '過載 ⚠' },
    };

    if (!nurses.length) {
        cardsEl.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">今日尚無護理師紀錄</p>';
        // 清空圖表
        if (workloadChart) { workloadChart.destroy(); workloadChart = null; }
        return;
    }

    // 渲染卡片
    cardsEl.innerHTML = nurses.map(n => {
        const c = LEVEL_COLOR[n.load_level] || LEVEL_COLOR.low;
        return `
        <div class="workload-card" style="border-left:4px solid ${c.border};background:${c.bg}">
            <div class="wl-card-header">
                <span class="wl-nurse-name">${n.nurse_name}</span>
                <span class="wl-level-badge" style="color:${c.text};border-color:${c.border}">${c.label}</span>
            </div>
            <div class="wl-stats">
                <div class="wl-stat">
                    <span class="wl-stat-num">${n.record_count}</span>
                    <span class="wl-stat-label">SOAP 紀錄</span>
                </div>
                <div class="wl-stat">
                    <span class="wl-stat-num" style="color:${n.alert_count > 0 ? 'var(--danger)' : 'inherit'}">${n.alert_count}</span>
                    <span class="wl-stat-label">安全警示</span>
                </div>
                <div class="wl-stat">
                    <span class="wl-stat-num">${n.patient_count}</span>
                    <span class="wl-stat-label">負責病患</span>
                </div>
                <div class="wl-stat">
                    <span class="wl-stat-num" style="color:${n.high_risk_patients > 0 ? 'var(--warning)' : 'inherit'}">${n.high_risk_patients}</span>
                    <span class="wl-stat-label">高風險病患</span>
                </div>
            </div>
        </div>`;
    }).join('');

    // 渲染長條圖
    renderWorkloadChart(nurses, LEVEL_COLOR);
}

/**
 * 用 Chart.js 渲染護理師工作負荷長條圖（紀錄數 + 警示數）。
 */
function renderWorkloadChart(nurses, LEVEL_COLOR) {
    const ctx = document.getElementById('workload-chart');
    if (!ctx) return;

    if (workloadChart) { workloadChart.destroy(); workloadChart = null; }

    const labels = nurses.map(n => n.nurse_name);
    const recordData = nurses.map(n => n.record_count);
    const alertData = nurses.map(n => n.alert_count);
    const bgColors = nurses.map(n => (LEVEL_COLOR[n.load_level] || LEVEL_COLOR.low).border);

    workloadChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'SOAP 紀錄數',
                    data: recordData,
                    backgroundColor: bgColors.map(c => c + '99'), // 60% 透明
                    borderColor: bgColors,
                    borderWidth: 2,
                    borderRadius: 4,
                },
                {
                    label: '安全警示數',
                    data: alertData,
                    backgroundColor: 'rgba(198,40,40,0.25)',
                    borderColor: '#c62828',
                    borderWidth: 2,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        afterBody: function(items) {
                            const idx = items[0]?.dataIndex;
                            if (idx == null) return '';
                            const n = nurses[idx];
                            return [
                                `負責病患：${n.patient_count} 人`,
                                `高風險病患：${n.high_risk_patients} 人`,
                                `負荷等級：${n.load_level}`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 },
                    title: { display: true, text: '次數' }
                },
                x: {
                    title: { display: true, text: '護理師' }
                }
            }
        }
    });
}

// 在 DOMContentLoaded 時初始化日期選擇器
document.addEventListener('DOMContentLoaded', () => {
    initWorkloadDate();
});

// ══════════════════════════════════════
// 智慧給藥提醒 + 未給藥警示
// ══════════════════════════════════════

/**
 * 給藥提醒排程表。
 * 格式：[{ patientId, patientName, drugName, dose, unit, scheduledTime (HH:MM), timerId, done }]
 */
let medicationReminders = [];
let _notificationPermission = 'default'; // 'default' | 'granted' | 'denied'

/**
 * 請求瀏覽器通知權限（登入後呼叫一次）。
 */
async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        _notificationPermission = 'granted';
        return;
    }
    if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        _notificationPermission = perm;
    } else {
        _notificationPermission = 'denied';
    }
}

/**
 * 從 SOAP P（計畫）欄位文字中解析給藥時間。
 *
 * 支援格式：
 *   - 絕對時間：「14:00 給 Morphine」「下午兩點 Voren」「2pm Morphine」
 *   - 相對頻率：「Q4H」「Q6H」「Q8H」「Q12H」「BID」「TID」「QID」「QD」
 *   - PRN：「PRN Morphine」（不排程，只標記為 PRN）
 *
 * @param {string} planText — SOAP P 欄位文字
 * @param {Array}  medications — 本次 SOAP 的藥物列表
 * @returns {Array} — [{ drugName, dose, unit, scheduledTime, isPRN }]
 */
function parseMedicationSchedule(planText, medications) {
    if (!planText || !medications?.length) return [];
    const results = [];
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    // 建立藥物名稱查找集合（含別名）
    const drugNames = medications.map(m => ({
        name: m.name,
        dose: m.dose || '',
        unit: m.unit || '',
        pattern: new RegExp(m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }));

    // ── 1. 絕對時間解析 ──
    // 格式：HH:MM、HH點、上午/下午 + 時間
    const absTimePatterns = [
        // 24h 格式：14:00、14:30
        /(\d{1,2}):(\d{2})/g,
        // 中文時間：下午兩點、上午十點
        /(?:上午|早上)(\d{1,2})點/g,
        /(?:下午|晚上)(\d{1,2})點/g,
        // 英文 am/pm：2pm、10am
        /(\d{1,2})\s*(?:am|pm)/gi,
    ];

    // 提取所有絕對時間點
    const absoluteTimes = [];

    // HH:MM
    let m;
    const hhmmRe = /(\d{1,2}):(\d{2})/g;
    while ((m = hhmmRe.exec(planText)) !== null) {
        const h = parseInt(m[1]);
        const min = parseInt(m[2]);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
            absoluteTimes.push({ h, min, raw: m[0] });
        }
    }

    // 上午 X 點
    const amRe = /(?:上午|早上)(\d{1,2})點/g;
    while ((m = amRe.exec(planText)) !== null) {
        const h = parseInt(m[1]);
        if (h >= 1 && h <= 12) absoluteTimes.push({ h, min: 0, raw: m[0] });
    }

    // 下午 X 點
    const pmRe = /(?:下午|晚上)(\d{1,2})點/g;
    while ((m = pmRe.exec(planText)) !== null) {
        const h = parseInt(m[1]) + 12;
        if (h >= 13 && h <= 23) absoluteTimes.push({ h, min: 0, raw: m[0] });
    }

    // X am/pm
    const ampmRe = /(\d{1,2})\s*(am|pm)/gi;
    while ((m = ampmRe.exec(planText)) !== null) {
        let h = parseInt(m[1]);
        if (m[2].toLowerCase() === 'pm' && h < 12) h += 12;
        if (m[2].toLowerCase() === 'am' && h === 12) h = 0;
        absoluteTimes.push({ h, min: 0, raw: m[0] });
    }

    // 對每個絕對時間，找最近的藥物名稱（前後 50 字元內）
    for (const t of absoluteTimes) {
        const timeIdx = planText.indexOf(t.raw);
        const context = planText.substring(Math.max(0, timeIdx - 50), timeIdx + 50);
        for (const drug of drugNames) {
            if (drug.pattern.test(context)) {
                const scheduledTime = `${t.h.toString().padStart(2, '0')}:${t.min.toString().padStart(2, '0')}`;
                results.push({
                    drugName: drug.name,
                    dose: drug.dose,
                    unit: drug.unit,
                    scheduledTime,
                    isPRN: false,
                    source: 'absolute'
                });
            }
        }
    }

    // ── 2. 頻率解析（Q4H / Q6H / BID / TID / QID / QD）──
    const freqMap = {
        'QD':  [8],                          // 每日一次：早上 8 點
        'QHS': [22],                         // 睡前：晚上 10 點
        'BID': [8, 20],                      // 每日兩次：早 8、晚 8
        'TID': [8, 14, 20],                  // 每日三次：早 8、下午 2、晚 8
        'QID': [8, 12, 16, 20],              // 每日四次
        'Q4H': [0, 4, 8, 12, 16, 20],       // 每 4 小時
        'Q6H': [0, 6, 12, 18],              // 每 6 小時
        'Q8H': [0, 8, 16],                  // 每 8 小時
        'Q12H': [0, 12],                    // 每 12 小時
    };

    for (const [freq, hours] of Object.entries(freqMap)) {
        const freqRe = new RegExp(freq, 'i');
        if (!freqRe.test(planText)) continue;

        // 找頻率附近的藥物
        const freqIdx = planText.search(freqRe);
        const context = planText.substring(Math.max(0, freqIdx - 60), freqIdx + 60);

        for (const drug of drugNames) {
            if (!drug.pattern.test(context)) continue;

            // 只排程「下一個」時間點（未來最近的）
            const nextHour = hours.find(h => h > currentHour || (h === currentHour && 0 > currentMin));
            const targetHour = nextHour !== undefined ? nextHour : hours[0]; // 若今天都過了，取第一個（明天）
            const scheduledTime = `${targetHour.toString().padStart(2, '0')}:00`;

            // 避免重複加入同一藥物
            const alreadyAdded = results.some(r => r.drugName === drug.name && r.scheduledTime === scheduledTime);
            if (!alreadyAdded) {
                results.push({
                    drugName: drug.name,
                    dose: drug.dose,
                    unit: drug.unit,
                    scheduledTime,
                    isPRN: false,
                    source: `freq:${freq}`
                });
            }
        }
    }

    // ── 3. PRN 標記 ──
    const prnRe = /PRN/i;
    if (prnRe.test(planText)) {
        const prnIdx = planText.search(prnRe);
        const context = planText.substring(Math.max(0, prnIdx - 40), prnIdx + 40);
        for (const drug of drugNames) {
            if (drug.pattern.test(context)) {
                const alreadyAdded = results.some(r => r.drugName === drug.name);
                if (!alreadyAdded) {
                    results.push({
                        drugName: drug.name,
                        dose: drug.dose,
                        unit: drug.unit,
                        scheduledTime: null,
                        isPRN: true,
                        source: 'PRN'
                    });
                }
            }
        }
    }

    return results;
}

/**
 * 計算距離指定時間（HH:MM）還有幾毫秒。
 * 若時間已過，回傳 null（不排程）。
 */
function msUntil(timeStr) {
    if (!timeStr) return null;
    const [h, min] = timeStr.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, min, 0, 0);
    const diff = target - now;
    return diff > 0 ? diff : null; // 已過時間不排程
}

/**
 * 推送瀏覽器通知。
 */
function pushMedNotification(patientName, drugName, dose, unit, scheduledTime) {
    const body = `${patientName} — ${drugName} ${dose}${unit} 給藥時間到了`;
    if (_notificationPermission === 'granted') {
        try {
            new Notification('💊 給藥提醒', { body, icon: 'logo.png', tag: `med-${patientName}-${drugName}` });
        } catch (e) {
            console.warn('[MedReminder] Notification 失敗', e);
        }
    }
    // 同時在畫面上顯示 Toast
    showToast(`💊 給藥提醒：${body}`, 6000);
    // 標記為已提醒
    const reminder = medicationReminders.find(r =>
        r.patientName === patientName && r.drugName === drugName && r.scheduledTime === scheduledTime
    );
    if (reminder) reminder.notified = true;
}

/**
 * 為一筆 SOAP 紀錄排程給藥提醒。
 * 在 confirmSave() 成功後呼叫。
 *
 * @param {Object} patient — 病患資料 { id, name }
 * @param {Object} soap    — SOAP 物件 { plan, ... }
 * @param {Array}  medications — 藥物列表
 */
function scheduleMedicationReminders(patient, soap, medications) {
    if (!patient || !soap?.plan || !medications?.length) return;

    const schedule = parseMedicationSchedule(soap.plan, medications);
    if (!schedule.length) return;

    for (const item of schedule) {
        if (item.isPRN || !item.scheduledTime) continue; // PRN 不自動排程

        const delay = msUntil(item.scheduledTime);
        if (delay === null) continue; // 時間已過，跳過

        // 避免重複排程同一病患同一藥物同一時間
        const exists = medicationReminders.some(r =>
            r.patientId === patient.id &&
            r.drugName === item.drugName &&
            r.scheduledTime === item.scheduledTime
        );
        if (exists) continue;

        const timerId = setTimeout(() => {
            pushMedNotification(patient.name, item.drugName, item.dose, item.unit, item.scheduledTime);
            renderPendingMedications(); // 重新渲染未完成清單
        }, delay);

        medicationReminders.push({
            patientId: patient.id,
            patientName: patient.name,
            drugName: item.drugName,
            dose: item.dose,
            unit: item.unit,
            scheduledTime: item.scheduledTime,
            timerId,
            notified: false,
            done: false,
        });

        console.log(`[MedReminder] 已排程：${patient.name} ${item.drugName} @ ${item.scheduledTime}（${Math.round(delay / 60000)} 分鐘後）`);
    }

    renderPendingMedications();
}

/**
 * 手動標記某筆給藥提醒為「已完成」。
 */
function markMedDone(patientId, drugName, scheduledTime) {
    const reminder = medicationReminders.find(r =>
        r.patientId === patientId &&
        r.drugName === drugName &&
        r.scheduledTime === scheduledTime
    );
    if (reminder) {
        reminder.done = true;
        clearTimeout(reminder.timerId);
        addAuditLog('給藥完成', `${reminder.patientName} — ${drugName} ${scheduledTime}`);
    }
    renderPendingMedications();
}

/**
 * 渲染「本班未完成給藥清單」。
 * 顯示在巡房模式側邊欄和交班儀表板。
 */
function renderPendingMedications() {
    const pending = medicationReminders.filter(r => !r.done);
    const now = new Date();
    const currentTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // 分類：已逾時（時間已過但未完成）vs 待執行
    const overdue = pending.filter(r => r.scheduledTime && r.scheduledTime < currentTimeStr);

    const html = pending.length === 0
        ? '<p class="med-reminder-empty">本班無待執行給藥項目 ✓</p>'
        : pending.map(r => {
            const isOverdue = r.scheduledTime && r.scheduledTime < currentTimeStr;
            return `
            <div class="med-reminder-item ${isOverdue ? 'overdue' : ''}">
                <div class="med-reminder-info">
                    <span class="med-reminder-time">${r.scheduledTime || 'PRN'}</span>
                    <span class="med-reminder-patient">${r.patientName}</span>
                    <span class="med-reminder-drug">${r.drugName} ${r.dose}${r.unit}</span>
                    ${isOverdue ? '<span class="med-reminder-overdue-badge">逾時</span>' : ''}
                </div>
                <button class="btn btn-small btn-success" onclick="markMedDone('${r.patientId}','${r.drugName}','${r.scheduledTime}')">✓ 已給</button>
            </div>`;
        }).join('');

    // 更新巡房模式側邊欄
    const sideEl = document.getElementById('med-reminder-panel');
    if (sideEl) {
        sideEl.innerHTML = html;
        // 更新 badge 數量
        const badge = document.getElementById('med-reminder-badge');
        if (badge) {
            const overdueCount = pending.filter(r => r.scheduledTime && r.scheduledTime < currentTimeStr).length;
            badge.textContent = pending.length > 0 ? pending.length : '';
            badge.style.display = pending.length > 0 ? '' : 'none';
            badge.style.background = overdueCount > 0 ? 'var(--danger)' : 'var(--accent)';
        }
    }

    // 更新交班儀表板的未完成清單
    const handoverEl = document.getElementById('handover-med-reminders');
    if (handoverEl) handoverEl.innerHTML = html;
}

// 每分鐘重新渲染一次（更新逾時狀態）
setInterval(renderPendingMedications, 60000);

// ══════════════════════════════════════
// SBAR 交班口語稿生成
// ══════════════════════════════════════

/**
 * 呼叫後端 /sbar/generate，生成 SBAR 交班口語稿。
 * 收集本班所有病患的最新紀錄，送給 LLM 生成。
 */
async function generateSBAR() {
    const btn = document.getElementById('sbar-btn');
    const section = document.getElementById('sbar-section');
    const loading = document.getElementById('sbar-loading');
    const content = document.getElementById('sbar-content');

    if (!patients.length) {
        showToast('目前沒有病患資料');
        return;
    }

    // 顯示區塊和 loading 狀態
    section.classList.remove('hidden');
    loading.classList.remove('hidden');
    content.innerHTML = '';
    setButtonLoading(btn, true);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        // 收集所有病患的紀錄（從後端取最新資料）
        const patientsPayload = await Promise.all(patients.map(async p => {
            let recs = allRecords[p.id] || [];
            // 若本地快取為空，嘗試從後端取
            if (!recs.length) {
                try {
                    const res = await fetchWithTimeout(`${API}/records/patient/${p.id}`, {
                        headers: getAuthHeaders()
                    });
                    if (res.ok) {
                        const data = await res.json();
                        recs = data.map(r => ({
                            soap: r.soap,
                            medications: r.medications || [],
                            pain_scale: r.pain_scale,
                            alerts: r.alerts || [],
                        }));
                    }
                } catch (_) { /* 使用本地快取 */ }
            }
            return {
                name: p.name,
                bed: p.bed,
                dx: p.dx || '',
                age: p.age || '',
                records: recs.slice(-3), // 最多取最近 3 筆
            };
        }));

        // 過濾掉沒有紀錄的病患
        const patientsWithRecords = patientsPayload.filter(p => p.records.length > 0);

        if (!patientsWithRecords.length) {
            loading.classList.add('hidden');
            content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">本班尚無護理紀錄，無法生成交班口語稿。</p>';
            return;
        }

        const payload = {
            shift: getCurrentShift(),
            nurse_name: currentUser?.name || '',
            patients: patientsWithRecords,
        };

        const res = await fetchWithTimeout(`${API}/sbar/generate`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload),
        }, 120000); // SBAR 生成最多等 2 分鐘

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        loading.classList.add('hidden');
        renderSBAR(data);
        addAuditLog('生成 SBAR', `${getCurrentShift()} 交班口語稿，共 ${data.patients?.length || 0} 位病患`);

    } catch (e) {
        loading.classList.add('hidden');
        content.innerHTML = `<p style="color:var(--danger);padding:16px">⚠ 生成失敗：${e.message}<br><small>請確認後端 Ollama 正在運行</small></p>`;
    } finally {
        setButtonLoading(btn, false);
    }
}

/**
 * 渲染 SBAR 口語稿到畫面。
 * 每位病患一張卡片，SBAR 四個欄位分色顯示。
 */
function renderSBAR(data) {
    const content = document.getElementById('sbar-content');
    if (!content) return;

    const { sbar_text, patients: sbarPatients, shift, nurse_name } = data;

    // 儲存原始文字供複製/列印用
    content.dataset.rawText = sbar_text || '';

    const SBAR_COLORS = {
        S: { bg: 'rgba(198,40,40,.07)',  border: '#c62828', label: 'S 現況' },
        B: { bg: 'rgba(45,58,140,.07)',  border: '#2d3a8c', label: 'B 背景' },
        A: { bg: 'rgba(245,124,0,.07)',  border: '#f57c00', label: 'A 評估' },
        R: { bg: 'rgba(56,142,60,.07)',  border: '#388e3c', label: 'R 建議' },
    };

    const headerHtml = `
        <div class="sbar-meta">
            <span class="sbar-shift-badge">${shift}</span>
            <span>護理師：${nurse_name}</span>
            <span style="color:var(--text-muted);font-size:.8rem">共 ${sbarPatients.length} 位病患</span>
        </div>`;

    const cardsHtml = sbarPatients.map(sp => {
        const sbarRows = ['S', 'B', 'A', 'R'].map(key => {
            const c = SBAR_COLORS[key];
            return `
            <div class="sbar-row" style="background:${c.bg};border-left:3px solid ${c.border}">
                <span class="sbar-row-label" style="color:${c.border}">${c.label}</span>
                <span class="sbar-row-text">${sp[key] || '—'}</span>
            </div>`;
        }).join('');

        return `
        <div class="sbar-patient-card">
            <div class="sbar-patient-header">
                <span class="sbar-patient-name">${sp.name}</span>
                <span class="sbar-patient-bed">${sp.bed}</span>
            </div>
            <div class="sbar-rows">${sbarRows}</div>
        </div>`;
    }).join('');

    content.innerHTML = headerHtml + cardsHtml;
}

/**
 * 複製 SBAR 純文字到剪貼簿。
 */
async function copySBAR() {
    const content = document.getElementById('sbar-content');
    const text = content?.dataset.rawText || content?.innerText || '';
    if (!text) { showToast('沒有可複製的內容'); return; }
    try {
        await navigator.clipboard.writeText(text);
        showToast('✓ 已複製到剪貼簿');
    } catch (e) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('✓ 已複製到剪貼簿');
    }
}

/**
 * 列印 SBAR 口語稿（只印 SBAR 區塊）。
 */
function printSBAR() {
    const section = document.getElementById('sbar-section');
    if (!section) return;
    // 加上列印標記 class，CSS @media print 會只顯示此區塊
    document.body.classList.add('print-sbar-only');
    window.print();
    document.body.classList.remove('print-sbar-only');
}

/**
 * 關閉 SBAR 區塊。
 */
function closeSBAR() {
    const section = document.getElementById('sbar-section');
    if (section) section.classList.add('hidden');
}

// ══════════════════════════════════════
// 護理師情緒壓力偵測
// ══════════════════════════════════════

const STRESS_LEVEL_CONFIG = {
    low:      { color: '#388e3c', bg: 'rgba(56,142,60,.1)',   border: '#388e3c', label: '狀態良好', icon: '✨' },
    medium:   { color: '#f57c00', bg: 'rgba(245,124,0,.1)',   border: '#f57c00', label: '注意休息', icon: '🌿' },
    high:     { color: '#e65100', bg: 'rgba(230,81,0,.1)',    border: '#e65100', label: '需要關注', icon: '💛' },
    critical: { color: '#c62828', bg: 'rgba(198,40,40,.1)',   border: '#c62828', label: '高度關注', icon: '💙' },
};

/**
 * 登入後自動分析自己的壓力狀態，顯示關懷提示。
 * 只在壓力等級 medium 以上才顯示 banner，避免打擾。
 */
async function checkSelfStress() {
    if (!currentUser?.employee_id) return;
    try {
        const res = await fetchWithTimeout(
            `${API}/stress/nurse/${currentUser.employee_id}?days=7`,
            { headers: getAuthHeaders() }
        );
        if (!res.ok) return;
        const data = await res.json();

        // 只在 medium 以上顯示 banner
        if (data.stress_level === 'low') return;

        const cfg = STRESS_LEVEL_CONFIG[data.stress_level] || STRESS_LEVEL_CONFIG.low;
        const banner = document.getElementById('care-banner');
        const msg = document.getElementById('care-banner-msg');
        const icon = document.getElementById('care-banner-icon');

        if (banner && msg) {
            icon.textContent = cfg.icon;
            msg.textContent = data.care_message;
            banner.style.borderLeftColor = cfg.border;
            banner.style.background = cfg.bg;
            banner.classList.remove('hidden');

            // 高壓力等級自動 30 秒後收起（不強迫護理師一直看到）
            if (data.stress_level !== 'critical') {
                setTimeout(() => banner.classList.add('hidden'), 30000);
            }
        }
    } catch (e) {
        // 靜默失敗，不影響主流程
        console.warn('[Stress] 自我壓力分析失敗', e);
    }
}

function dismissCareBanner() {
    const banner = document.getElementById('care-banner');
    if (banner) banner.classList.add('hidden');
}

/**
 * 載入全體護理師壓力概覽（護理長視角）。
 * 在交班儀表板切換時呼叫。
 */
async function loadTeamStress() {
    const el = document.getElementById('stress-overview-cards');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">載入中...</p>';

    try {
        const res = await fetchWithTimeout(
            `${API}/stress/team?days=7`,
            { headers: getAuthHeaders() }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderTeamStress(data);
    } catch (e) {
        el.innerHTML = `<p style="color:var(--danger);font-size:.85rem">⚠ 載入失敗：${e.message}</p>`;
    }
}

/**
 * 渲染全體護理師壓力概覽卡片。
 */
function renderTeamStress(data) {
    const el = document.getElementById('stress-overview-cards');
    if (!el) return;

    const nurses = data.nurses || [];
    if (!nurses.length) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">過去 7 天尚無護理師紀錄</p>';
        return;
    }

    el.innerHTML = nurses.map(n => {
        const cfg = STRESS_LEVEL_CONFIG[n.stress_level] || STRESS_LEVEL_CONFIG.low;
        const indicators = [];
        if (n.late_night_count > 0) indicators.push(`深夜補寫 ${n.late_night_count} 次`);
        if (n.work_days >= 5) indicators.push(`連續 ${n.work_days} 天工作`);

        return `
        <div class="stress-card" style="border-left:4px solid ${cfg.border};background:${cfg.bg}">
            <div class="stress-card-header">
                <span class="stress-nurse-name">${cfg.icon} ${n.nurse_name}</span>
                <span class="stress-level-badge" style="color:${cfg.color};border-color:${cfg.border}">${cfg.label}</span>
            </div>
            <div class="stress-card-body">
                <div class="stress-score-bar-wrap">
                    <div class="stress-score-bar" style="width:${n.stress_score}%;background:${cfg.border}"></div>
                </div>
                <div class="stress-meta">
                    <span>${n.total_records} 筆紀錄</span>
                    <span>${n.work_days} 工作天</span>
                    ${n.late_night_count > 0 ? `<span style="color:var(--danger)">深夜補寫 ${n.late_night_count} 次</span>` : ''}
                </div>
                ${indicators.length ? `<div class="stress-indicators">${indicators.map(i => `<span class="stress-indicator-tag">${i}</span>`).join('')}</div>` : ''}
            </div>
        </div>`;
    }).join('');
}
