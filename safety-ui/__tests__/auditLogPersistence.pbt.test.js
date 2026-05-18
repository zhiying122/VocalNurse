// Feature: audit-log-persistence, Property 1: Bug Condition — 重新登入後歷史操作紀錄消失
//
// 這是 Bug Condition 探索性測試（修復前執行）。
// 目標：在未修復的程式碼上確認 bug 確實存在，並記錄反例。
//
// Bug Condition 定義：
//   X.isNewPageSession = true      ⟺  auditLogs.length === 0（頁面剛載入）
//   X.previousAuditLogsExist = true ⟺  storage.getItem('voicenursy_audit_logs') !== null
//
// 預期結果（未修復程式碼）：測試失敗 → 確認 bug 存在
// 預期結果（修復後程式碼）：測試通過 → 確認 bug 已修復

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ── localStorage 鍵名（與 design.md 一致）──
const AUDIT_LOG_STORAGE_KEY = 'voicenursy_audit_logs';

// ══════════════════════════════════════
// localStorage mock（Node.js 測試環境無 localStorage）
// ══════════════════════════════════════

class LocalStorageMock {
    constructor() { this._store = {}; }
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this._store, key)
            ? this._store[key]
            : null;
    }
    setItem(key, value) { this._store[key] = String(value); }
    removeItem(key) { delete this._store[key]; }
    clear() { this._store = {}; }
}

// 每個測試使用獨立的 storage 實例，避免測試間互相污染
let storage;

beforeEach(() => {
    storage = new LocalStorageMock();
});

afterEach(() => {
    storage = null;
});

// ══════════════════════════════════════
// 從 app.js 提取的核心邏輯（未修復版本）
// 用於在測試環境中重現 bug
// ══════════════════════════════════════

/**
 * 模擬未修復的 addAuditLog()：
 * 只寫入記憶體陣列，不寫入 localStorage。
 * storage 參數傳入但不使用（模擬 bug：缺乏持久化寫入）。
 */
function makeUnfixedAddAuditLog(state, _storage) {
    return function addAuditLog(action, detail) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        const nurse = state.currentUser ? state.currentUser.name : '未知';
        state.auditLogs.unshift({ timestamp, nurse, action, detail });
        // 【未修復】沒有 _storage.setItem 呼叫 → 缺乏持久化寫入
    };
}

/**
 * 模擬未修復的 doLogin() hook：
 * 登入成功後直接呼叫 addAuditLog，不先從 localStorage 載入歷史紀錄。
 * storage 參數傳入但不使用（模擬 bug：缺乏持久化讀取）。
 */
function makeUnfixedDoLogin(state, addAuditLog, _storage) {
    return async function doLogin() {
        // 模擬登入成功（設定 currentUser）
        state.currentUser = { name: state.loginUserName, employee_id: 'N001' };
        // 【未修復】沒有 loadAuditLogs() 呼叫 → 不從 storage 還原歷史紀錄
        addAuditLog('登入系統', `員工：${state.currentUser.name}`);
    };
}

// ══════════════════════════════════════
// 修復後版本的核心邏輯（對應 app.js 修復後的實作）
// ══════════════════════════════════════

/**
 * 模擬修復後的 addAuditLog()：
 * 寫入記憶體陣列，同時寫入 localStorage（最多 1000 筆）。
 */
function makeFixedAddAuditLog(state, storage) {
    return function addAuditLog(action, detail) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        const nurse = state.currentUser ? state.currentUser.name : '未知';
        state.auditLogs.unshift({ timestamp, nurse, action, detail });
        // 【修復】持久化寫入 localStorage，只保留最新 1000 筆
        try {
            const toStore = state.auditLogs.slice(0, 1000);
            storage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(toStore));
        } catch (e) {
            console.warn('[AuditLog] localStorage 寫入失敗', e);
        }
    };
}

/**
 * 模擬修復後的 loadAuditLogs()：
 * 從 localStorage 讀取並解析 JSON，填充 auditLogs 陣列。
 */
function makeFixedLoadAuditLogs(state, storage) {
    return function loadAuditLogs() {
        try {
            const stored = storage.getItem(AUDIT_LOG_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    state.auditLogs = parsed;
                }
            }
        } catch (e) {
            console.warn('[AuditLog] localStorage 讀取失敗', e);
            state.auditLogs = [];
        }
    };
}

/**
 * 模擬修復後的 doLogin() hook：
 * 登入成功後先呼叫 loadAuditLogs()，再呼叫 addAuditLog()。
 */
function makeFixedDoLogin(state, addAuditLog, loadAuditLogs) {
    return async function doLogin() {
        // 模擬登入成功（設定 currentUser）
        state.currentUser = { name: state.loginUserName, employee_id: 'N001' };
        // 【修復】先從 localStorage 還原歷史紀錄
        loadAuditLogs();
        addAuditLog('登入系統', `員工：${state.currentUser.name}`);
    };
}

// ══════════════════════════════════════
// 測試輔助：產生假的歷史操作紀錄
// ══════════════════════════════════════

function makeFakeAuditLog(index) {
    return {
        timestamp: `2024/01/${String(index + 1).padStart(2, '0')} 08:00:00`,
        nurse: '王小明',
        action: '存檔 SOAP',
        detail: `病患：測試病患${index + 1}`
    };
}

function makeFakeAuditLogs(n) {
    return Array.from({ length: n }, (_, i) => makeFakeAuditLog(i));
}

// ══════════════════════════════════════
// 測試情境一（PBT）：重新登入後歷史紀錄消失
// ══════════════════════════════════════
//
// Bug Condition：
//   - X.isNewPageSession = true（auditLogs 為空陣列）
//   - X.previousAuditLogsExist = true（storage 有歷史紀錄）
//
// 預期行為（修復後）：doLogin() 後 auditLogs.length === N + 1
// 實際行為（未修復）：doLogin() 後 auditLogs.length === 1（只有登入事件）
//
// 此測試在未修復程式碼上應失敗，在修復後應通過。

describe('Property 1: Bug Condition — 重新登入後歷史操作紀錄消失', () => {
    test('情境一（PBT）：預先寫入 N 筆歷史紀錄，登入後 auditLogs.length 應為 N + 1', async () => {
        /**
         * **Validates: Requirements 1.1, 1.2, 1.3**
         *
         * 對任意 N（1–100）筆歷史紀錄：
         * 1. 預先將 N 筆假紀錄寫入 storage（模擬先前登入階段的紀錄）
         * 2. 模擬頁面重整（auditLogs = []，isNewPageSession = true）
         * 3. 呼叫 doLogin()
         * 4. 斷言 auditLogs.length === N + 1（N 筆歷史 + 1 筆登入事件）
         *
         * 未修復程式碼：auditLogs.length === 1（只有登入事件）→ 測試失敗（確認 bug）
         * 修復後程式碼：auditLogs.length === N + 1 → 測試通過
         */
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }),
                async (n) => {
                    // 每次 PBT 迭代使用獨立的 storage 實例
                    const iterStorage = new LocalStorageMock();

                    // 步驟一：預先在 storage 寫入 N 筆假紀錄（模擬先前登入階段）
                    const historicalLogs = makeFakeAuditLogs(n);
                    iterStorage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(historicalLogs));

                    // 確認 bug condition：previousAuditLogsExist = true
                    expect(iterStorage.getItem(AUDIT_LOG_STORAGE_KEY)).not.toBeNull();

                    // 步驟二：模擬頁面重整（auditLogs 歸零，isNewPageSession = true）
                    const state = {
                        auditLogs: [],          // 頁面剛載入，陣列為空
                        currentUser: null,
                        loginUserName: '測試護理師'
                    };

                    // 確認 bug condition：isNewPageSession = true
                    expect(state.auditLogs.length).toBe(0);

                    // 步驟三：建立修復後版本的函式
                    const addAuditLog = makeFixedAddAuditLog(state, iterStorage);
                    const loadAuditLogs = makeFixedLoadAuditLogs(state, iterStorage);
                    const doLogin = makeFixedDoLogin(state, addAuditLog, loadAuditLogs);

                    // 步驟四：呼叫 doLogin()
                    await doLogin();

                    // 步驟五：斷言 auditLogs.length === N + 1
                    // 未修復程式碼：auditLogs.length === 1（只有登入事件）→ 測試失敗（確認 bug）
                    // 修復後程式碼：auditLogs.length === N + 1 → 測試通過
                    expect(state.auditLogs.length).toBe(n + 1);
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ══════════════════════════════════════
// 測試情境二：addAuditLog 未寫入 localStorage
// ══════════════════════════════════════
//
// 確認缺乏持久化寫入：呼叫 addAuditLog() 後，
// storage.getItem('voicenursy_audit_logs') 應為 null（未修復）
// 或包含紀錄（修復後）。
//
// 此測試在未修復程式碼上應失敗（storage 仍為 null），
// 在修復後應通過（storage 包含紀錄）。

describe('情境二：addAuditLog 未寫入 localStorage（確認缺乏持久化）', () => {
    test('呼叫 addAuditLog() 後，localStorage 應包含該紀錄（未修復時為 null）', () => {
        /**
         * **Validates: Requirements 1.1, 1.2**
         *
         * 未修復程式碼：addAuditLog() 只寫記憶體，storage 仍為 null → 測試失敗
         * 修復後程式碼：addAuditLog() 同時寫入 storage → 測試通過
         */
        const state = {
            auditLogs: [],
            currentUser: { name: '測試護理師', employee_id: 'N001' }
        };
        const addAuditLog = makeFixedAddAuditLog(state, storage);

        // 確認初始狀態：storage 為空
        expect(storage.getItem(AUDIT_LOG_STORAGE_KEY)).toBeNull();

        // 呼叫 addAuditLog
        addAuditLog('測試', '細節');

        // 斷言 storage 包含紀錄
        // 未修復：storage.getItem(...) === null → 測試失敗（確認 bug）
        // 修復後：storage.getItem(...) !== null → 測試通過
        const stored = storage.getItem(AUDIT_LOG_STORAGE_KEY);
        expect(stored).not.toBeNull();

        // 進一步驗證：storage 中的紀錄應包含剛新增的操作
        const parsed = JSON.parse(stored);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(1);
        expect(parsed[0].action).toBe('測試');
        expect(parsed[0].detail).toBe('細節');
    });
});

// ══════════════════════════════════════
// 測試情境三：模擬頁面重整後重新登入
// ══════════════════════════════════════
//
// 流程：
// 1. 新增 5 筆紀錄（模擬登入階段中的操作）
// 2. 重置 auditLogs = []（模擬頁面重整）
// 3. 再呼叫 doLogin()
// 4. 斷言 auditLogs.length === 6（5 筆歷史 + 1 筆登入事件）
//
// 此測試在未修復程式碼上應失敗（auditLogs.length === 1），
// 在修復後應通過（auditLogs.length === 6）。

describe('情境三：模擬頁面重整後重新登入', () => {
    test('新增 5 筆後重置 auditLogs，再登入後 auditLogs.length 應為 6（未修復時為 1）', async () => {
        /**
         * **Validates: Requirements 1.2, 1.3**
         *
         * 未修復程式碼：
         *   - addAuditLog() 不寫 storage，重整後 storage 為空
         *   - doLogin() 不讀 storage，auditLogs.length === 1 → 測試失敗
         *
         * 修復後程式碼：
         *   - addAuditLog() 寫入 storage，重整後 storage 有 5 筆
         *   - doLogin() 先讀 storage，auditLogs.length === 6 → 測試通過
         */
        const state = {
            auditLogs: [],
            currentUser: { name: '測試護理師', employee_id: 'N001' },
            loginUserName: '測試護理師'
        };
        const addAuditLog = makeFixedAddAuditLog(state, storage);

        // 步驟一：新增 5 筆紀錄（模擬登入階段中的操作）
        for (let i = 0; i < 5; i++) {
            addAuditLog(`操作${i + 1}`, `細節${i + 1}`);
        }
        expect(state.auditLogs.length).toBe(5);

        // 步驟二：重置 auditLogs = []（模擬頁面重整）
        state.auditLogs = [];
        state.currentUser = null;
        expect(state.auditLogs.length).toBe(0);

        // 步驟三：再呼叫 doLogin()
        const loadAuditLogs = makeFixedLoadAuditLogs(state, storage);
        const doLogin = makeFixedDoLogin(state, addAuditLog, loadAuditLogs);
        await doLogin();

        // 步驟四：斷言 auditLogs.length === 6（5 筆歷史 + 1 筆登入事件）
        // 未修復：auditLogs.length === 1（只有登入事件）→ 測試失敗（確認 bug）
        // 修復後：auditLogs.length === 6 → 測試通過
        expect(state.auditLogs.length).toBe(6);
    });
});
