/**
 * IndexedDB 離線同步機制
 *
 * 醫院 WiFi 經常不穩定，護理師在病房巡視時可能會斷線。
 * 本模組提供離線暫存功能：
 *
 * 1. 當後端 API 無法連線時，SOAP 紀錄會暫存到瀏覽器的 IndexedDB
 * 2. 每筆離線紀錄都有 synced=false 標記，表示尚未同步到後端
 * 3. 當網路恢復（online 事件觸發）時，自動將未同步的紀錄逐筆上傳
 * 4. 上傳成功後標記為 synced=true，避免重複上傳
 * 5. 若同步過程中又斷線，會停止當前批次，等下次網路恢復再繼續
 *
 * IndexedDB 結構：
 *   資料庫名稱：VoiceNursyDB
 *   物件儲存區：soap_records
 *   索引：synced（用於快速查詢未同步紀錄）、patientId、timestamp
 *
 * 與 app.js 的關係：
 *   - app.js 的 confirmSave() 在 API 失敗時會呼叫 saveRecordLocally()
 *   - app.js 的 selectPatient() 在 API 失敗時會呼叫 getPatientRecords() 作為 fallback
 *   - autoSync() 使用 app.js 的全域變數 authToken、API、getAuthHeaders()、fetchWithTimeout()
 */

// ── IndexedDB 設定常數 ──
const DB_NAME = 'VoiceNursyDB';   // 資料庫名稱
const DB_VERSION = 1;              // 資料庫版本（升級 schema 時需遞增）
const STORE_NAME = 'soap_records'; // 物件儲存區名稱

let db = null; // IndexedDB 連線實例（初始化後賦值）

/**
 * 初始化 IndexedDB 連線。
 * 頁面載入時自動呼叫（見檔案底部）。
 * 若資料庫不存在會自動建立，並建立必要的索引。
 */
function initOfflineDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'localId', autoIncrement: true });
                store.createIndex('synced', 'synced', { unique: false });
                store.createIndex('patientId', 'patientId', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('[Offline] IndexedDB 已初始化');
            resolve(db);
        };

        request.onerror = (e) => {
            console.error('[Offline] IndexedDB 初始化失敗', e);
            reject(e);
        };
    });
}

/**
 * 儲存一筆紀錄到 IndexedDB（離線暫存）。
 *
 * 呼叫時機：
 *   app.js 的 confirmSave() 在後端 API 呼叫失敗時（網路斷線），
 *   會呼叫此函式將紀錄暫存到本地。
 *
 * 參數 record 的結構（來自 confirmSave 的 catch 區塊）：
 *   {
 *     patientId:   "P8EE7C3",      // 病患 ID
 *     patientName: "林芝",          // 病患姓名
 *     soap:        { ... },         // SOAP 四欄位
 *     medications: [ ... ],         // 藥物列表
 *     pain_scale:  5,               // 疼痛指數
 *     alerts:      [ ... ],         // 安全警示
 *     time:        "09:30",         // 建立時間（HH:MM）
 *     date:        "2025-01-15",    // 建立日期
 *     raw:         "原始文字...",    // 原始語音辨識文字
 *     nurse_id:    "N001",          // 建立者員工編號
 *     nurse_name:  "王小明",        // 建立者姓名
 *     shift:       "日班",          // 班別
 *     synced:      false            // 同步狀態（false = 尚未同步）
 *   }
 *
 * 回傳：Promise<number> — IndexedDB 自動產生的 localId
 */
function saveRecordLocally(record) {
    return new Promise((resolve, reject) => {
        if (!db) { reject('DB 未初始化'); return; }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const entry = {
            ...record,
            synced: false,
            timestamp: new Date().toISOString(),
        };

        const request = store.add(entry);
        request.onsuccess = () => {
            console.log('[Offline] 紀錄已存入本地');
            resolve(request.result);
        };
        request.onerror = (e) => reject(e);
    });
}

/**
 * 取得所有尚未同步到後端的紀錄。
 * autoSync() 會呼叫此函式，取得需要上傳的紀錄列表。
 * 透過 IndexedDB 的 synced 索引，快速篩選 synced=false 的紀錄。
 *
 * 回傳：Promise<Array> — 未同步紀錄的陣列
 */
function getUnsyncedRecords() {
    return new Promise((resolve, reject) => {
        if (!db) { resolve([]); return; }

        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('synced');
        const request = index.getAll(false);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
    });
}

/**
 * 將指定紀錄標記為已同步（synced=true）。
 * autoSync() 在成功上傳一筆紀錄後會呼叫此函式，
 * 避免下次同步時重複上傳。
 *
 * 參數：localId — IndexedDB 自動產生的紀錄 ID
 */
function markAsSynced(localId) {
    return new Promise((resolve, reject) => {
        if (!db) { reject('DB 未初始化'); return; }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(localId);

        request.onsuccess = () => {
            const record = request.result;
            if (record) {
                record.synced = true;
                store.put(record);
                resolve();
            }
        };
        request.onerror = (e) => reject(e);
    });
}

/**
 * 取得特定病患的所有本地紀錄（含已同步和未同步的）。
 *
 * 呼叫時機：
 *   app.js 的 selectPatient() 在後端 API 呼叫失敗時，
 *   會呼叫此函式作為 fallback，從本地 IndexedDB 載入紀錄。
 *
 * 參數：patientId — 病患 ID（例如 "P8EE7C3"）
 * 回傳：Promise<Array> — 該病患的所有本地紀錄
 */
function getPatientRecords(patientId) {
    return new Promise((resolve, reject) => {
        if (!db) { resolve([]); return; }

        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('patientId');
        const request = index.getAll(patientId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
    });
}

/**
 * 顯示/更新同步進度指示器。
 * 在畫面右上角顯示「同步中 1/5...」的浮動提示。
 * 使用 role="status" 和 aria-live="polite" 確保螢幕閱讀器可以讀取。
 *
 * 參數：
 *   current — 目前正在同步第幾筆
 *   total   — 總共需要同步幾筆
 */
function showSyncIndicator(current, total) {
    let indicator = document.getElementById('sync-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'sync-indicator';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');
        indicator.style.cssText = 'position:fixed;top:12px;right:12px;background:#1565c0;color:#fff;padding:8px 16px;border-radius:8px;font-size:.85rem;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.2);';
        document.body.appendChild(indicator);
    }
    indicator.textContent = `同步中 ${current}/${total}...`;
}

/**
 * 隱藏同步進度指示器（同步完成或失敗時呼叫）。
 */
function hideSyncIndicator() {
    const indicator = document.getElementById('sync-indicator');
    if (indicator) indicator.remove();
}

/**
 * 自動同步：將 IndexedDB 中未同步的紀錄逐筆上傳到後端。
 *
 * 觸發時機：
 *   1. 瀏覽器偵測到網路恢復（window 'online' 事件）
 *   2. 只有在使用者已登入（authToken 存在）時才會執行
 *
 * 同步流程：
 *   1. 檢查是否已登入（需要 JWT token 才能呼叫 /records API）
 *   2. 從 IndexedDB 取得所有 synced=false 的紀錄
 *   3. 顯示同步進度指示器（「同步中 1/5...」）
 *   4. 逐筆 POST 到後端 /records API
 *   5. 成功 → markAsSynced()，繼續下一筆
 *   6. 失敗 → break 停止當前批次（等下次 online 事件再重試）
 *   7. 隱藏進度指示器
 *
 * 注意事項：
 *   - 使用 app.js 的全域變數：authToken、API、getAuthHeaders()、fetchWithTimeout()
 *   - IndexedDB 的 alerts 欄位需要轉換為 warnings 字串陣列（後端格式不同）
 *   - 後端有重複紀錄檢查機制，即使同一筆紀錄被上傳兩次也不會重複儲存
 */
async function autoSync() {
    // Only sync if user is logged in (authToken available from app.js)
    // 只有在使用者已登入時才同步（需要 JWT token 才能呼叫後端 API）
    if (typeof authToken === 'undefined' || !authToken) return;

    const records = await getUnsyncedRecords();
    if (!records.length) return; // 沒有未同步的紀錄，直接結束

    console.log(`[Offline] 開始同步 ${records.length} 筆紀錄...`);
    const total = records.length;

    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        showSyncIndicator(i + 1, total); // 更新進度指示器

        try {
            // 將 IndexedDB 的欄位格式轉換為後端 POST /records 的格式
            // IndexedDB 用 patientId，後端用 patient_id（底線命名）
            // IndexedDB 用 alerts（物件陣列），後端用 warnings（字串陣列）
            const payload = {
                patient_id: record.patientId,
                soap: record.soap,
                medications: record.medications || [],
                pain_scale: record.pain_scale,
                warnings: (record.alerts || []).map(a => typeof a === 'string' ? a : (a.message || '')),
                raw_text: record.raw || '',
                shift: record.shift || ''
            };

            // 使用 app.js 的 fetchWithTimeout 和 getAuthHeaders
            const res = await fetchWithTimeout(`${API}/records`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);

            // 上傳成功，標記為已同步
            await markAsSynced(record.localId);
            console.log(`[Offline] 已同步紀錄 #${record.localId}`);
        } catch (e) {
            // 同步失敗（網路又斷了或 API 錯誤）
            // 停止當前批次，等下次 online 事件再重試
            console.warn(`[Offline] 同步失敗 #${record.localId}`, e);
            break;
        }
    }

    hideSyncIndicator(); // 同步結束，隱藏進度指示器
}

// ── 監聽瀏覽器網路狀態變化 ──
// 當網路恢復時自動觸發同步，斷線時更新狀態指示器
window.addEventListener('online', () => {
    console.log('[Offline] 網路已恢復，開始自動同步');
    updateNetworkStatus(true);
    autoSync(); // 網路恢復 → 自動上傳未同步紀錄
});

window.addEventListener('offline', () => {
    console.log('[Offline] 網路已斷線，切換離線模式');
    updateNetworkStatus(false);
});

/**
 * 更新畫面上的網路狀態指示器（「● 線上」或「● 離線」）。
 * 對應 HTML 中 id="network-status" 的元素。
 */
function updateNetworkStatus(isOnline) {
    const indicator = document.getElementById('network-status');
    if (indicator) {
        indicator.textContent = isOnline ? '● 線上' : '● 離線';
        indicator.className = isOnline ? 'net-online' : 'net-offline';
        indicator.className = isOnline ? 'net-online' : 'net-offline';
    }
}

// ── 頁面載入時自動初始化 IndexedDB ──
initOfflineDB();
