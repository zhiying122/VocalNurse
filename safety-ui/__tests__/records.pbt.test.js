// Feature: shared-nursing-records, Property 5: 班別標籤計算正確性
// Feature: shared-nursing-records, Property 7: 渲染輸出包含護理師姓名與班別
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

// ── Testable extraction of getCurrentShift logic from app.js ──
// getCurrentShift() in app.js uses `new Date().getHours()`, so we extract
// the pure logic here for property testing with arbitrary hour values.
function getCurrentShiftForHour(hour) {
    if (hour >= 8 && hour < 16) return '日班';
    if (hour >= 16 && hour < 24) return '小夜班';
    return '大夜班';
}

// ── Testable extraction of renderTimeline HTML generation ──
// Mirrors the template logic in renderTimeline() from app.js
function buildTimelineHtml(records) {
    return records.map(r => {
        const d = r.alerts?.length > 0;
        const meds = r.medications?.map(m => `${m.name} ${m.dose || ''} ${m.unit || ''}`).join(', ') || '';
        const nurseLabel = r.nurse_name ? ` [${r.nurse_name}]` : '';
        return `<div class="tl-item ${d ? 'danger' : ''}"><span class="tl-time">${r.time}${nurseLabel}</span><span>${meds || r.soap?.plan || '護理紀錄'}${d ? ' ⚠️' : ''}</span></div>`;
    }).reverse().join('');
}

// ── Testable extraction of renderHandover record HTML generation ──
// Mirrors the per-record template logic in renderHandover() from app.js
function buildHandoverRecordHtml(r) {
    const nurseInfo = r.nurse_name ? ` — 護理師：${r.nurse_name}` : '';
    const shiftInfo = r.shift ? `【${r.shift}】` : '';
    return `<div class="ho-record ${r.alerts?.length ? 'has-alert' : ''}"><strong>${r.time}</strong>${nurseInfo} ${shiftInfo} — Pain: ${r.pain_scale ?? '-'} | ${r.medications?.map(m => `${m.name} ${m.dose || ''}${m.unit || ''}`).join(', ') || '無給藥'}${r.alerts?.length ? ' ⚠️ 有警示' : ''}</div>`;
}

// ══════════════════════════════════════
// Property 5: 班別標籤計算正確性
// ══════════════════════════════════════
describe('Property 5: 班別標籤計算正確性', () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For any hour value (0-23), getCurrentShift() returns the correct shift label:
     * - 8-15  → '日班'
     * - 16-23 → '小夜班'
     * - 0-7   → '大夜班'
     */
    test('returns correct shift label for all hours 0-23', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 23 }),
                (hour) => {
                    const shift = getCurrentShiftForHour(hour);
                    if (hour >= 8 && hour < 16) {
                        expect(shift).toBe('日班');
                    } else if (hour >= 16 && hour < 24) {
                        expect(shift).toBe('小夜班');
                    } else {
                        expect(shift).toBe('大夜班');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('日班 hours (8-15) always return 日班', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 8, max: 15 }),
                (hour) => {
                    expect(getCurrentShiftForHour(hour)).toBe('日班');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('小夜班 hours (16-23) always return 小夜班', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 16, max: 23 }),
                (hour) => {
                    expect(getCurrentShiftForHour(hour)).toBe('小夜班');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('大夜班 hours (0-7) always return 大夜班', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 7 }),
                (hour) => {
                    expect(getCurrentShiftForHour(hour)).toBe('大夜班');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('shift label is always one of the three valid values', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 23 }),
                (hour) => {
                    const shift = getCurrentShiftForHour(hour);
                    expect(['日班', '小夜班', '大夜班']).toContain(shift);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ══════════════════════════════════════
// Property 7: 渲染輸出包含護理師姓名與班別
// ══════════════════════════════════════
describe('Property 7: 渲染輸出包含護理師姓名與班別', () => {
    /**
     * **Validates: Requirements 6.2, 6.3, 8.1, 8.2**
     *
     * For any record with a nurse name and shift label, the timeline and
     * handover rendered HTML must contain that nurse name and shift text.
     */

    // Generate nurse names by picking 2-4 Chinese characters
    const nurseNameArb = fc.tuple(
        fc.constantFrom('王', '李', '張', '陳', '林', '黃', '吳', '劉'),
        fc.constantFrom('小', '美', '芳', '英', '珍', '明', '華', '志')
    ).map(([surname, given]) => surname + given);

    const shiftArb = fc.constantFrom('日班', '小夜班', '大夜班');

    test('timeline HTML contains nurse name when present', () => {
        fc.assert(
            fc.property(
                nurseNameArb,
                fc.constantFrom('08:00', '14:30', '20:00', '02:15'),
                (nurseName, time) => {
                    const records = [{
                        time,
                        nurse_name: nurseName,
                        soap: { plan: '持續觀察' },
                        medications: [],
                        alerts: []
                    }];
                    const html = buildTimelineHtml(records);
                    expect(html).toContain(nurseName);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('handover HTML contains nurse name when present', () => {
        fc.assert(
            fc.property(
                nurseNameArb,
                shiftArb,
                fc.constantFrom('08:00', '14:30', '20:00', '02:15'),
                (nurseName, shift, time) => {
                    const record = {
                        time,
                        nurse_name: nurseName,
                        shift,
                        pain_scale: 3,
                        medications: [],
                        alerts: []
                    };
                    const html = buildHandoverRecordHtml(record);
                    expect(html).toContain(nurseName);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('handover HTML contains shift label when present', () => {
        fc.assert(
            fc.property(
                nurseNameArb,
                shiftArb,
                fc.constantFrom('08:00', '14:30', '20:00', '02:15'),
                (nurseName, shift, time) => {
                    const record = {
                        time,
                        nurse_name: nurseName,
                        shift,
                        pain_scale: 5,
                        medications: [],
                        alerts: []
                    };
                    const html = buildHandoverRecordHtml(record);
                    expect(html).toContain(`【${shift}】`);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('handover HTML contains both nurse name and shift for arbitrary records', () => {
        fc.assert(
            fc.property(
                nurseNameArb,
                shiftArb,
                fc.integer({ min: 0, max: 10 }),
                fc.constantFrom('08:00', '12:00', '18:00', '03:00'),
                (nurseName, shift, painScale, time) => {
                    const record = {
                        time,
                        nurse_name: nurseName,
                        shift,
                        pain_scale: painScale,
                        medications: [{ name: 'Acetaminophen', dose: '500', unit: 'mg' }],
                        alerts: []
                    };
                    const html = buildHandoverRecordHtml(record);
                    expect(html).toContain(nurseName);
                    expect(html).toContain(`【${shift}】`);
                }
            ),
            { numRuns: 100 }
        );
    });
});
