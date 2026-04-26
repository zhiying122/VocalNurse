/**
 * IndexedDB 離線同步機制
 * 醫院 WiFi 不穩時，紀錄暫存本地，網路恢復後自動上傳
 */

const DB_NAME = 'VoiceNursyDB';
const DB_VERSION = 1;
const STORE_NAME = 'soap_records';

let db = null;

/**
 * 初始化 IndexedDB
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
 * 儲存紀錄到本地（離線或線上都會存）
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
 * 取得所有未同步的紀錄
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
 * 標記紀錄為已同步
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
 * 取得特定病患的所有本地紀錄
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
 * 自動同步：網路恢復時觸發
 */
async function autoSync() {
    const records = await getUnsyncedRecords();
    if (!records.length) return;

    console.log(`[Offline] 開始同步 ${records.length} 筆紀錄...`);

    for (const record of records) {
        try {
            // 實際部署時會 POST 到後端 API
            // await fetch('/api/sync', { method: 'POST', body: JSON.stringify(record) });
            await markAsSynced(record.localId);
            console.log(`[Offline] 已同步紀錄 #${record.localId}`);
        } catch (e) {
            console.warn(`[Offline] 同步失敗 #${record.localId}`, e);
            break;  // 網路又斷了，停止同步
        }
    }
}

// 監聽網路狀態變化
window.addEventListener('online', () => {
    console.log('[Offline] 網路已恢復，開始自動同步');
    updateNetworkStatus(true);
    autoSync();
});

window.addEventListener('offline', () => {
    console.log('[Offline] 網路已斷線，切換離線模式');
    updateNetworkStatus(false);
});

function updateNetworkStatus(isOnline) {
    const indicator = document.getElementById('network-status');
    if (indicator) {
        indicator.textContent = isOnline ? '🟢 線上' : '🔴 離線';
        indicator.className = isOnline ? 'net-online' : 'net-offline';
    }
}

// 初始化
initOfflineDB();
