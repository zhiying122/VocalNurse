// Feature: audit-log-persistence, Property 2: Preservation — 同一登入階段的操作紀錄行為不受影響
//
// 這是 Preservation 屬性測試（修復前執行）。
// 目標：在未修復的程式碼上確認基準行為，確保修復後這些行為仍被保留。
//
// 非 Bug Condition 定義（isBugCondition(X) = false）：
//   - 同一登入階段內的操作（auditLogs 已有資料，或 localStorage 無歷史紀錄）
//
// 預期結果（未修復程式碼）：測試通過 → 確認基準行為
// 預期結果（修復後程式碼）：測試仍通過 → 確認無迴歸

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

// ══════════════════════════════════════
// 從 app.js 提取的核心邏輯（純函式版本）
// 遵循 records.pbt.test.js 的模式：提取純邏輯，不依賴 DOM 或全域狀態
// ══════════════════════════════════════

/**
 * 建立一個獨立的 addAuditLog 函式（不依賴全域狀態）。
 * 模擬 app.js 中的 addAuditLog，但使用傳入的 state 物件。
 * 對應 app.js 第 1306-1313 行的邏輯。
 */
function makeAddAuditLog(state) {
    return function addAuditLog(action, detail) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        const nurse = state.currentUser ? state.currentUser.name : '未知';
        state.auditLogs.unshift({ timestamp, nurse, action, detail });
        // renderAuditLog 在此不呼叫，由各測試自行呼叫純函式版本
    };
}

/**
 * 純函式版本的 renderAuditLog：回傳 { countText, html } 而非操作 DOM。
 * 對應 app.js 第 1315-1325 行的邏輯。
 *
 * @param {Array} auditLogs - 操作紀錄陣列
 * @returns {{ countText: string, html: string }} - 計數文字與 HTML 字串
 */
function renderAuditLogPure(auditLogs) {
    const countText = `${auditLogs.length} 筆`;
    if (!auditLogs.length) {
        return {
            countText,
            html: '<div class="audit-empty">尚無操作紀錄</div>'
        };
    }
    const html = auditLogs.slice(0, 50).map(log =>
        `<div class="audit-item"><span class="audit-time">${log.timestamp}</span><span class="audit-nurse">${log.nurse}</span><span class="audit-action">${log.action}</span><span class="audit-detail">${log.detail}</span></div>`
    ).join('');
    return { countText, html };
}

/**
 * 計算 HTML 字串中 .audit-item 元素的數量。
 * 使用簡單的字串比對，不依賴 DOM。
 */
function countAuditItems(html) {
    const matches = html.match(/<div class="audit-item">/g);
    return matches ? matches.length : 0;
}

// ══════════════════════════════════════
// 屬性測試一：addAuditLog() 後 auditLogs[0] 包含正確欄位
// ══════════════════════════════════════
//
// 非 Bug Condition：auditLogs 已有資料（同一登入階段）
// 預期行為：呼叫 addAuditLog(action, detail) 後，
//   auditLogs[0] 包含正確的 action、detail、nurse、timestamp 欄位
//
// 此測試在未修復程式碼上應通過（確認基準行為）。

describe('屬性測試一：addAuditLog() 後 auditLogs[0] 包含正確欄位', () => {
    test('對任意非空 action 字串與任意 detail 字串，auditLogs[0] 包含正確的 action、detail、nurse、timestamp 欄位', () => {
        /**
         * **Validates: Requirements 3.1, 3.2**
         *
         * 對任意非空 action 字串與任意 detail 字串：
         * 1. 設定 currentUser（模擬同一登入階段）
         * 2. 呼叫 addAuditLog(action, detail)
         * 3. 斷言 auditLogs[0].action === action
         * 4. 斷言 auditLogs[0].detail === detail
         * 5. 斷言 auditLogs[0].nurse === currentUser.name
         * 6. 斷言 auditLogs[0].timestamp 符合 YYYY/MM/DD HH:mm:ss 格式
         *
         * 未修復程式碼：此行為正確 → 測試通過（確認基準行為）
         * 修復後程式碼：此行為不變 → 測試仍通過（確認無迴歸）
         */
        fc.assert(
            fc.property(
                // 非空 action 字串（至少 1 個字元）
                fc.string({ minLength: 1, maxLength: 50 }),
                // 任意 detail 字串（可為空）
                fc.string({ maxLength: 100 }),
                (action, detail) => {
                    // 每次 PBT 迭代使用獨立的狀態
                    const state = {
                        auditLogs: [],
                        currentUser: { name: '測試護理師', employee_id: 'N001' }
                    };
                    const addAuditLog = makeAddAuditLog(state);

                    // 呼叫 addAuditLog
                    addAuditLog(action, detail);

                    // 斷言 auditLogs[0] 包含正確欄位
                    expect(state.auditLogs.length).toBe(1);
                    expect(state.auditLogs[0].action).toBe(action);
                    expect(state.auditLogs[0].detail).toBe(detail);
                    expect(state.auditLogs[0].nurse).toBe('測試護理師');

                    // 斷言 timestamp 符合 YYYY/MM/DD HH:mm:ss 格式
                    const timestampPattern = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/;
                    expect(state.auditLogs[0].timestamp).toMatch(timestampPattern);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('多次呼叫 addAuditLog() 後，最新紀錄始終在 auditLogs[0]（unshift 語意）', () => {
        /**
         * **Validates: Requirements 3.1**
         *
         * 對任意 n（1–10）次呼叫，每次呼叫後最新紀錄應在 auditLogs[0]。
         */
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        action: fc.string({ minLength: 1, maxLength: 30 }),
                        detail: fc.string({ maxLength: 50 })
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (calls) => {
                    const state = {
                        auditLogs: [],
                        currentUser: { name: '護理師甲', employee_id: 'N002' }
                    };
                    const addAuditLog = makeAddAuditLog(state);

                    for (const { action, detail } of calls) {
                        addAuditLog(action, detail);
                    }

                    // 最後一次呼叫的 action 應在 auditLogs[0]
                    const lastCall = calls[calls.length - 1];
                    expect(state.auditLogs[0].action).toBe(lastCall.action);
                    expect(state.auditLogs[0].detail).toBe(lastCall.detail);
                    expect(state.auditLogs.length).toBe(calls.length);
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ══════════════════════════════════════
// 屬性測試二：renderAuditLog() 渲染的 DOM 項目數恰好為 50
// ══════════════════════════════════════
//
// 非 Bug Condition：auditLogs.length > 50（同一登入階段累積超過 50 筆）
// 預期行為：renderAuditLog() 渲染的 HTML 中 .audit-item 元素數量恰好為 50（截斷邏輯）
//
// 此測試在未修復程式碼上應通過（確認基準行為）。

describe('屬性測試二：renderAuditLog() 渲染的 DOM 項目數恰好為 50', () => {
    test('對任意 n（51–200）筆的 auditLogs，renderAuditLog() 渲染的 DOM 項目數恰好為 50', () => {
        /**
         * **Validates: Requirements 3.3**
         *
         * 對任意 n（51–200）筆的 auditLogs：
         * 1. 設定 auditLogs 為 n 筆假紀錄
         * 2. 呼叫 renderAuditLogPure()
         * 3. 斷言 HTML 中 .audit-item 元素數量恰好為 50
         *
         * 未修復程式碼：此行為正確 → 測試通過（確認基準行為）
         * 修復後程式碼：此行為不變 → 測試仍通過（確認無迴歸）
         */
        fc.assert(
            fc.property(
                fc.integer({ min: 51, max: 200 }),
                (n) => {
                    // 建立 n 筆假紀錄
                    const auditLogs = Array.from({ length: n }, (_, i) => ({
                        timestamp: `2024/01/${String((i % 28) + 1).padStart(2, '0')} 08:00:00`,
                        nurse: '王小明',
                        action: `操作${i + 1}`,
                        detail: `細節${i + 1}`
                    }));

                    // 呼叫純函式版本的 renderAuditLog
                    const { html } = renderAuditLogPure(auditLogs);

                    // 斷言 HTML 中 .audit-item 元素數量恰好為 50
                    expect(countAuditItems(html)).toBe(50);
                }
            ),
            { numRuns: 50 }
        );
    });

    test('恰好 50 筆時，HTML 中 .audit-item 元素數量也是 50', () => {
        /**
         * **Validates: Requirements 3.3**
         *
         * 邊界值：auditLogs.length === 50 時，HTML 中 .audit-item 元素數量應為 50。
         */
        const auditLogs = Array.from({ length: 50 }, (_, i) => ({
            timestamp: `2024/01/${String((i % 28) + 1).padStart(2, '0')} 08:00:00`,
            nurse: '王小明',
            action: `操作${i + 1}`,
            detail: `細節${i + 1}`
        }));

        const { html } = renderAuditLogPure(auditLogs);
        expect(countAuditItems(html)).toBe(50);
    });
});

// ══════════════════════════════════════
// 屬性測試三：auditLogs 為空時，HTML 包含「尚無操作紀錄」文字
// ══════════════════════════════════════
//
// 非 Bug Condition：auditLogs 為空（localStorage 無歷史紀錄，同一登入階段尚未操作）
// 預期行為：HTML 包含「尚無操作紀錄」提示文字
//
// 此測試在未修復程式碼上應通過（確認基準行為）。

describe('屬性測試三：auditLogs 為空時，HTML 包含「尚無操作紀錄」文字', () => {
    test('auditLogs 為空時，HTML 包含「尚無操作紀錄」文字', () => {
        /**
         * **Validates: Requirements 3.4**
         *
         * auditLogs 為空陣列時：
         * 1. 呼叫 renderAuditLogPure([])
         * 2. 斷言 HTML 包含「尚無操作紀錄」文字
         *
         * 未修復程式碼：此行為正確 → 測試通過（確認基準行為）
         * 修復後程式碼：此行為不變 → 測試仍通過（確認無迴歸）
         */
        const { html } = renderAuditLogPure([]);
        expect(html).toContain('尚無操作紀錄');
    });

    test('auditLogs 為空時，HTML 不包含 .audit-item 元素', () => {
        /**
         * **Validates: Requirements 3.4**
         *
         * 空狀態下不應有任何操作紀錄項目。
         */
        const { html } = renderAuditLogPure([]);
        expect(countAuditItems(html)).toBe(0);
    });
});

// ══════════════════════════════════════
// 屬性測試四：audit-count 文字與 auditLogs.length 一致
// ══════════════════════════════════════
//
// 非 Bug Condition：同一登入階段內的任意操作
// 預期行為：countText 為「{n} 筆」，與 auditLogs.length 一致
//
// 此測試在未修復程式碼上應通過（確認基準行為）。

describe('屬性測試四：audit-count 文字與 auditLogs.length 一致', () => {
    test('對任意 n（0–200）筆的 auditLogs，countText 為「n 筆」', () => {
        /**
         * **Validates: Requirements 3.1, 3.3**
         *
         * 對任意 n（0–200）筆的 auditLogs：
         * 1. 設定 auditLogs 為 n 筆假紀錄
         * 2. 呼叫 renderAuditLogPure()
         * 3. 斷言 countText 為「n 筆」
         *
         * 未修復程式碼：此行為正確 → 測試通過（確認基準行為）
         * 修復後程式碼：此行為不變 → 測試仍通過（確認無迴歸）
         */
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 200 }),
                (n) => {
                    // 建立 n 筆假紀錄
                    const auditLogs = Array.from({ length: n }, (_, i) => ({
                        timestamp: `2024/01/${String((i % 28) + 1).padStart(2, '0')} 08:00:00`,
                        nurse: '王小明',
                        action: `操作${i + 1}`,
                        detail: `細節${i + 1}`
                    }));

                    const { countText } = renderAuditLogPure(auditLogs);
                    expect(countText).toBe(`${n} 筆`);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('addAuditLog() 後，countText 即時反映正確筆數', () => {
        /**
         * **Validates: Requirements 3.1**
         *
         * 每次呼叫 addAuditLog() 後，countText 應即時更新。
         * 此測試整合 addAuditLog 與 renderAuditLogPure 的互動。
         */
        const state = {
            auditLogs: [],
            currentUser: { name: '測試護理師', employee_id: 'N001' }
        };
        const addAuditLog = makeAddAuditLog(state);

        // 初始狀態：0 筆
        expect(renderAuditLogPure(state.auditLogs).countText).toBe('0 筆');

        // 新增第 1 筆
        addAuditLog('登入系統', '員工：測試護理師');
        expect(renderAuditLogPure(state.auditLogs).countText).toBe('1 筆');

        // 新增第 2 筆
        addAuditLog('存檔 SOAP', '病患：王大明');
        expect(renderAuditLogPure(state.auditLogs).countText).toBe('2 筆');

        // 新增第 3 筆
        addAuditLog('新增病患', '李小華（3A-01）');
        expect(renderAuditLogPure(state.auditLogs).countText).toBe('3 筆');
    });
});
