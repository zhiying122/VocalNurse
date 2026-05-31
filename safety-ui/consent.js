/**
 * VoiceNursy — IRB 知情同意 UI 模組（consent.js）
 *
 * 本模組負責所有知情同意相關的前端邏輯，包含：
 * 1. 同意狀態快取與查詢（fetchConsentStatus / getConsentStatusBatch）
 * 2. 知情同意書對話框（showConsentDialog / hideConsentDialog）
 * 3. UI 啟用/停用控制（enableRecordingUI / disableRecordingUI）
 * 4. 同意與拒絕操作（handleConsentAction）
 * 5. 撤回同意功能（showWithdrawButton / handleWithdraw）
 * 6. 病患卡片同意狀態標示（getConsentBadgeHTML / updatePatientCardBadge）
 *
 * 設計原則：
 * - 獨立模組，透過全域函式與 app.js 整合
 * - 不修改 app.js 的現有函式簽名
 * - 所有 API 呼叫使用 app.js 的 fetchWithTimeout 與 getAuthHeaders
 */

// ══════════════════════════════════════════════════════════
// 模組層級快取
// ══════════════════════════════════════════════════════════

/**
 * 同意狀態快取（Map<patientId, ConsentStatusResponse>）
 * 避免重複呼叫 API，提升 UI 回應速度
 */
const consentCache = new Map();

// ══════════════════════════════════════════════════════════
// 7.1 同意狀態快取與查詢
// ══════════════════════════════════════════════════════════

/**
 * 查詢指定病患的知情同意狀態，並更新快取。
 *
 * @param {string} patientId — 病患 ID
 * @returns {Promise<Object>} ConsentStatusResponse
 */
async function fetchConsentStatus(patientId) {
    try {
        const res = await fetchWithTimeout(
            `${API}/consent/patient/${patientId}`,
            { headers: getAuthHeaders() }
        );
        if (!res.ok) {
            // 404 表示病患不存在，回傳 pending 預設值
            if (res.status === 404) {
                const defaultStatus = { patient_id: patientId, status: 'pending', consent_version: 'v1.0', version_match: true, last_updated: null, nurse_id: null };
                consentCache.set(patientId, defaultStatus);
                return defaultStatus;
            }
            throw new Error(`API 錯誤 ${res.status}`);
        }
        const data = await res.json();
        consentCache.set(patientId, data);
        return data;
    } catch (e) {
        console.warn('[Consent] fetchConsentStatus 失敗', e);
        // 網路失敗時回傳快取值或預設 pending
        const cached = consentCache.get(patientId);
        if (cached) return cached;
        return { patient_id: patientId, status: 'pending', consent_version: 'v1.0', version_match: true, last_updated: null, nurse_id: null };
    }
}

/**
 * 批次查詢所有病患的知情同意狀態，更新快取。
 *
 * @returns {Promise<void>}
 */
async function getConsentStatusBatch() {
    try {
        const res = await fetchWithTimeout(
            `${API}/consent/patients/status`,
            { headers: getAuthHeaders() }
        );
        if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
        const summaries = await res.json();
        summaries.forEach(s => {
            // 將 summary 格式轉為 ConsentStatusResponse 格式存入快取
            const existing = consentCache.get(s.patient_id) || {};
            consentCache.set(s.patient_id, {
                ...existing,
                patient_id: s.patient_id,
                status: s.status,
                consent_version: s.consent_version || 'v1.0',
                version_match: true,
                last_updated: s.last_updated,
            });
        });
    } catch (e) {
        console.warn('[Consent] getConsentStatusBatch 失敗', e);
    }
}

// ══════════════════════════════════════════════════════════
// 7.2 知情同意書對話框
// ══════════════════════════════════════════════════════════

/**
 * 顯示知情同意書對話框。
 *
 * @param {string} patientId — 病患 ID
 * @param {Object} consentStatus — ConsentStatusResponse
 */
function showConsentDialog(patientId, consentStatus) {
    // 移除舊的對話框（若存在）
    const existing = document.getElementById('consent-dialog-overlay');
    if (existing) existing.remove();

    const versionNotice = (consentStatus.version_match === false)
        ? `<div class="consent-version-notice" style="background:#fff3e0;border:1.5px solid #f57c00;border-radius:6px;padding:10px 14px;margin-bottom:14px;color:#e65100;font-size:.88rem;">
            ⚠ 同意書已更新（目前版本與病患同意版本不符），請重新取得病患同意。
           </div>`
        : '';

    const statusLabel = {
        pending: '尚未同意',
        declined: '已拒絕',
        withdrawn: '已撤回同意',
        consented: '已同意',
    }[consentStatus.status] || consentStatus.status;

    const overlay = document.createElement('div');
    overlay.id = 'consent-dialog-overlay';
    overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,.55);z-index:9000;
        display:flex;align-items:center;justify-content:center;
        padding:16px;box-sizing:border-box;
    `;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'consent-dialog-title');

    overlay.innerHTML = `
        <div class="consent-dialog" style="
            background:#fff;border-radius:12px;max-width:560px;width:100%;
            max-height:85vh;overflow-y:auto;padding:24px;
            box-shadow:0 8px 32px rgba(0,0,0,.18);
        ">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                <h2 id="consent-dialog-title" style="margin:0;font-size:1.1rem;color:#1e3a5f;">
                    📋 IRB 知情同意書
                </h2>
                <span style="font-size:.8rem;color:#888;background:#f5f5f5;padding:3px 8px;border-radius:12px;">
                    版本 ${consentStatus.consent_version || 'v1.0'}
                </span>
            </div>
            <div style="font-size:.85rem;color:#666;margin-bottom:12px;">
                病患目前狀態：<strong style="color:${_getStatusColor(consentStatus.status)}">${statusLabel}</strong>
            </div>
            ${versionNotice}
            <div id="consent-dialog-content" style="font-size:.88rem;line-height:1.7;color:#333;margin-bottom:20px;">
                <div style="text-align:center;color:#999;padding:20px;">載入同意書內容中...</div>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                <button
                    id="consent-decline-btn"
                    class="btn btn-secondary"
                    onclick="handleConsentAction('${patientId}', 'declined')"
                    style="border-color:#c62828;color:#c62828;"
                >
                    ✗ 病患拒絕
                </button>
                <button
                    id="consent-agree-btn"
                    class="btn btn-primary"
                    onclick="handleConsentAction('${patientId}', 'consent')"
                    style="background:#388e3c;border-color:#388e3c;"
                >
                    ✓ 病患同意
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 非同步載入同意書內容
    _loadConsentContent(patientId);
}

/**
 * 非同步載入同意書內容並填入對話框。
 * @param {string} patientId
 */
async function _loadConsentContent(patientId) {
    const contentEl = document.getElementById('consent-dialog-content');
    if (!contentEl) return;

    try {
        const res = await fetchWithTimeout(
            `${API}/consent/patient/${patientId}`,
            { headers: getAuthHeaders() }
        );
        // 使用預設的同意書段落（從快取或預設值）
        const sections = [
            { heading: '研究目的', content: '本系統旨在透過語音辨識技術協助護理師建立 SOAP 護理紀錄，提升護理記錄效率與品質。' },
            { heading: '收集的資料類型', content: '本系統將收集您的語音錄音及由語音轉換而成的護理紀錄文字，包含主訴、生命徵象、護理評估與計畫。' },
            { heading: '資料保存方式', content: '所有資料僅儲存於院內伺服器，不會傳輸至院外。資料保存期限依醫院規定辦理。' },
            { heading: '撤回同意權利', content: '您有權隨時撤回同意，撤回後系統將停止收集新資料，但已建立的護理紀錄依法規仍須保存。' },
            { heading: '聯絡窗口', content: '如有疑問，請聯絡本院 IRB 辦公室，電話：(02) XXXX-XXXX，電子郵件：irb@hospital.org.tw' },
        ];

        contentEl.innerHTML = sections.map(s => `
            <div style="margin-bottom:14px;">
                <h3 style="font-size:.9rem;color:#1e3a5f;margin:0 0 4px;">${s.heading}</h3>
                <p style="margin:0;color:#555;">${s.content}</p>
            </div>
        `).join('<hr style="border:none;border-top:1px solid #eee;margin:10px 0;">');
    } catch (e) {
        if (contentEl) {
            contentEl.innerHTML = '<p style="color:#c62828;font-size:.85rem;">⚠ 無法載入同意書內容，請確認網路連線。</p>';
        }
    }
}

/**
 * 關閉知情同意書對話框。
 */
function hideConsentDialog() {
    const overlay = document.getElementById('consent-dialog-overlay');
    if (overlay) overlay.remove();
}

// ══════════════════════════════════════════════════════════
// 7.3 UI 啟用/停用控制
// ══════════════════════════════════════════════════════════

/**
 * 停用錄音 UI（錄音按鈕與手動文字輸入）。
 * 在病患未同意時呼叫，防止建立護理紀錄。
 */
function disableRecordingUI() {
    const recordBtn = document.getElementById('record-btn');
    const manualText = document.getElementById('manual-text');
    const manualSendBtn = document.querySelector('button[onclick="sendManualText()"]');

    if (recordBtn) {
        recordBtn.disabled = true;
        recordBtn.style.opacity = '0.4';
        recordBtn.style.cursor = 'not-allowed';
        recordBtn.title = '需要病患知情同意才能錄音';
    }
    if (manualText) {
        manualText.disabled = true;
        manualText.style.opacity = '0.4';
        manualText.placeholder = '需要病患知情同意才能輸入';
    }
    if (manualSendBtn) {
        manualSendBtn.disabled = true;
        manualSendBtn.style.opacity = '0.4';
    }

    // 顯示同意提示橫幅
    _showConsentRequiredBanner();
}

/**
 * 啟用錄音 UI（恢復錄音按鈕與手動文字輸入）。
 * 在病患同意後呼叫。
 */
function enableRecordingUI() {
    const recordBtn = document.getElementById('record-btn');
    const manualText = document.getElementById('manual-text');
    const manualSendBtn = document.querySelector('button[onclick="sendManualText()"]');

    if (recordBtn) {
        recordBtn.disabled = false;
        recordBtn.style.opacity = '';
        recordBtn.style.cursor = '';
        recordBtn.title = '';
    }
    if (manualText) {
        manualText.disabled = false;
        manualText.style.opacity = '';
        manualText.placeholder = '直接輸入文字（Ctrl+Enter 送出）';
    }
    if (manualSendBtn) {
        manualSendBtn.disabled = false;
        manualSendBtn.style.opacity = '';
    }

    // 移除同意提示橫幅
    _hideConsentRequiredBanner();
}

/**
 * 顯示「需要知情同意」提示橫幅。
 */
function _showConsentRequiredBanner() {
    if (document.getElementById('consent-required-banner')) return;
    const mainArea = document.getElementById('main-area');
    if (!mainArea) return;

    const banner = document.createElement('div');
    banner.id = 'consent-required-banner';
    banner.style.cssText = `
        background:#fff3e0;border:1.5px solid #f57c00;border-radius:8px;
        padding:10px 16px;margin:8px 0;color:#e65100;font-size:.88rem;
        display:flex;align-items:center;gap:8px;
    `;
    banner.innerHTML = `
        <span>⚠</span>
        <span>此病患尚未完成知情同意，無法建立護理紀錄。請先取得病患同意。</span>
        <button
            class="btn btn-small btn-primary"
            style="margin-left:auto;font-size:.8rem;padding:4px 10px;background:#f57c00;border-color:#f57c00;"
            onclick="showConsentDialogForCurrentPatient()"
        >顯示同意書</button>
    `;

    const soapSection = mainArea.querySelector('.soap-section');
    if (soapSection) {
        soapSection.insertBefore(banner, soapSection.firstChild);
    }
}

/**
 * 移除「需要知情同意」提示橫幅。
 */
function _hideConsentRequiredBanner() {
    const banner = document.getElementById('consent-required-banner');
    if (banner) banner.remove();
}

/**
 * 為目前選中的病患顯示同意書對話框（供橫幅按鈕呼叫）。
 */
function showConsentDialogForCurrentPatient() {
    if (!currentPatient) return;
    const status = consentCache.get(currentPatient.id) || { status: 'pending', consent_version: 'v1.0', version_match: true };
    showConsentDialog(currentPatient.id, status);
}

// ══════════════════════════════════════════════════════════
// 7.4 同意與拒絕操作
// ══════════════════════════════════════════════════════════

/**
 * 處理同意或拒絕操作。
 *
 * @param {string} patientId — 病患 ID
 * @param {string} action — 'consent' 或 'declined'
 */
async function handleConsentAction(patientId, action) {
    const actionLabel = action === 'consent' ? '同意' : '拒絕';

    if (!confirm(`確認病患${actionLabel}知情同意書？`)) return;

    // 停用按鈕防止重複點擊
    const agreeBtn = document.getElementById('consent-agree-btn');
    const declineBtn = document.getElementById('consent-decline-btn');
    if (agreeBtn) agreeBtn.disabled = true;
    if (declineBtn) declineBtn.disabled = true;

    try {
        const res = await fetchWithTimeout(
            `${API}/consent/patient/${patientId}`,
            {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action, notes: '' }),
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `API 錯誤 ${res.status}`);
        }

        // 更新快取
        const newStatus = await fetchConsentStatus(patientId);

        hideConsentDialog();

        if (action === 'consent') {
            enableRecordingUI();
            updatePatientCardBadge(patientId, 'consented');
            showWithdrawButton(patientId);
            if (typeof addAuditLog === 'function') {
                addAuditLog('知情同意', `病患 ${patientId} 已同意`);
            }
            if (typeof showToast === 'function') showToast('✓ 病患已同意知情同意書');
        } else {
            disableRecordingUI();
            updatePatientCardBadge(patientId, 'declined');
            _removeWithdrawButton();
            if (typeof addAuditLog === 'function') {
                addAuditLog('知情同意', `病患 ${patientId} 已拒絕`);
            }
            if (typeof showToast === 'function') showToast('病患已拒絕知情同意書，無法建立護理紀錄');
        }
    } catch (e) {
        console.error('[Consent] handleConsentAction 失敗', e);
        if (typeof showToast === 'function') showToast('操作失敗：' + e.message);
        // 恢復按鈕
        if (agreeBtn) agreeBtn.disabled = false;
        if (declineBtn) declineBtn.disabled = false;
    }
}

// ══════════════════════════════════════════════════════════
// 7.5 撤回同意功能
// ══════════════════════════════════════════════════════════

/**
 * 在病患資訊區域顯示「撤回同意」按鈕（僅在 consented 狀態時）。
 *
 * @param {string} patientId — 病患 ID
 */
function showWithdrawButton(patientId) {
    _removeWithdrawButton();

    const patientInfo = document.getElementById('patient-info');
    if (!patientInfo) return;

    const btn = document.createElement('button');
    btn.id = 'consent-withdraw-btn';
    btn.className = 'btn btn-small btn-outline';
    btn.style.cssText = 'color:#c62828;border-color:#c62828;font-size:.78rem;';
    btn.textContent = '撤回同意';
    btn.onclick = () => handleWithdraw(patientId);
    btn.title = '撤回病患的知情同意';

    patientInfo.appendChild(btn);
}

/**
 * 移除「撤回同意」按鈕。
 */
function _removeWithdrawButton() {
    const btn = document.getElementById('consent-withdraw-btn');
    if (btn) btn.remove();
}

/**
 * 處理撤回同意操作。
 *
 * @param {string} patientId — 病患 ID
 */
async function handleWithdraw(patientId) {
    if (!confirm('確認撤回病患的知情同意？\n撤回後將無法建立新的護理紀錄，但已建立的紀錄依法規仍須保存。')) return;

    const btn = document.getElementById('consent-withdraw-btn');
    if (btn) { btn.disabled = true; btn.textContent = '處理中...'; }

    try {
        const res = await fetchWithTimeout(
            `${API}/consent/patient/${patientId}`,
            {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: 'withdrawn', notes: '' }),
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `API 錯誤 ${res.status}`);
        }

        // 更新快取
        await fetchConsentStatus(patientId);

        disableRecordingUI();
        updatePatientCardBadge(patientId, 'withdrawn');
        _removeWithdrawButton();

        if (typeof addAuditLog === 'function') {
            addAuditLog('撤回同意', `病患 ${patientId} 已撤回知情同意`);
        }
        if (typeof showToast === 'function') showToast('病患已撤回知情同意，無法建立新護理紀錄');
    } catch (e) {
        console.error('[Consent] handleWithdraw 失敗', e);
        if (typeof showToast === 'function') showToast('撤回失敗：' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '撤回同意'; }
    }
}

// ══════════════════════════════════════════════════════════
// 7.6 病患卡片同意狀態標示
// ══════════════════════════════════════════════════════════

/**
 * 取得同意狀態的 badge HTML。
 *
 * @param {string} status — 'consented' | 'pending' | 'declined' | 'withdrawn'
 * @returns {string} badge HTML 字串
 */
function getConsentBadgeHTML(status) {
    const config = {
        consented: { color: '#388e3c', bg: '#e8f5e9', label: '已同意' },
        pending:   { color: '#f57c00', bg: '#fff3e0', label: '待同意' },
        declined:  { color: '#c62828', bg: '#ffebee', label: '已拒絕' },
        withdrawn: { color: '#c62828', bg: '#ffebee', label: '已撤回' },
    };
    const c = config[status] || config.pending;
    return `<span class="consent-badge" style="
        display:inline-block;font-size:.7rem;padding:2px 7px;border-radius:10px;
        background:${c.bg};color:${c.color};border:1px solid ${c.color};
        margin-left:4px;vertical-align:middle;font-weight:500;
    ">${c.label}</span>`;
}

/**
 * 更新指定病患卡片上的同意狀態標示。
 *
 * @param {string} patientId — 病患 ID
 * @param {string} status — 同意狀態
 */
function updatePatientCardBadge(patientId, status) {
    const chip = document.getElementById(`chip-${patientId}`);
    if (!chip) return;

    // 移除舊的 badge
    const oldBadge = chip.querySelector('.consent-badge');
    if (oldBadge) oldBadge.remove();

    // 插入新 badge（在警示 badge 之前）
    const alertBadge = chip.querySelector('.chip-alert');
    const badgeEl = document.createElement('span');
    badgeEl.innerHTML = getConsentBadgeHTML(status);
    const newBadge = badgeEl.firstElementChild;

    if (alertBadge) {
        chip.insertBefore(newBadge, alertBadge);
    } else {
        chip.appendChild(newBadge);
    }
}

// ══════════════════════════════════════════════════════════
// 輔助函式
// ══════════════════════════════════════════════════════════

/**
 * 取得同意狀態對應的顏色。
 * @param {string} status
 * @returns {string} CSS 顏色值
 */
function _getStatusColor(status) {
    const colors = {
        consented: '#388e3c',
        pending:   '#f57c00',
        declined:  '#c62828',
        withdrawn: '#c62828',
    };
    return colors[status] || '#888';
}
