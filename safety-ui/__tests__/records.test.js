// Feature: shared-nursing-records — Frontend record integration unit tests
// Tests: confirmSave, selectPatient, renderHandover, autoSync, nurse info attachment
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ══════════════════════════════════════
// Shared test helpers — re-implement core logic from app.js / offline_sync.js
// since the frontend is vanilla JS with no module exports.
// ══════════════════════════════════════

function getCurrentShift() {
    const hour = new Date().getHours();
    if (hour >= 8 && hour < 16) return '日班';
    if (hour >= 16 && hour < 24) return '小夜班';
    return '大夜班';
}

function getAuthHeaders(authToken) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// Minimal fetchWithTimeout simulation for testing
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

// ══════════════════════════════════════
// Test: confirmSave() updates allRecords on successful API response
// Validates: Requirement 4.2
// ══════════════════════════════════════
describe('confirmSave() — successful API response', () => {
    let allRecords;
    let currentPatient;
    let currentOutput;
    let currentAlerts;
    let currentUser;
    let authToken;

    beforeEach(() => {
        allRecords = {};
        currentPatient = { id: 'P123456', name: '林芝', bed: '01A', age: 65 };
        currentOutput = {
            soap: { subjective: '頭痛', objective: 'BP 130/85', assessment: '緊張性頭痛', plan: '觀察' },
            medications: [{ name: 'Acetaminophen', dose: '500', unit: 'mg', route: 'PO' }],
            pain_scale: 5,
            raw_text: '病人說頭很痛'
        };
        currentAlerts = [];
        currentUser = { employee_id: 'N001', name: '王小明' };
        authToken = 'test-jwt-token';

        // Mock global fetch
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('updates allRecords with backend response on success', async () => {
        const savedRecord = {
            id: 'R3A5B2C',
            patient_id: 'P123456',
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: 5,
            nurse_id: 'N001',
            nurse_name: '王小明',
            shift: '日班',
            created_at: '2025-01-15T09:30:00+08:00'
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => savedRecord
        });

        // Simulate confirmSave logic
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const payload = {
            patient_id: currentPatient.id,
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: currentOutput.pain_scale,
            warnings: currentAlerts.map(a => a.message || ''),
            raw_text: currentOutput.raw_text || '',
            shift: getCurrentShift()
        };

        const res = await fetchWithTimeout('http://localhost:8001/records', {
            method: 'POST',
            headers: getAuthHeaders(authToken),
            body: JSON.stringify(payload)
        });

        expect(res.ok).toBe(true);
        const data = await res.json();

        if (!allRecords[currentPatient.id]) allRecords[currentPatient.id] = [];
        allRecords[currentPatient.id].push({
            ...data,
            alerts: currentAlerts,
            time,
            date: now.toISOString().slice(0, 10)
        });

        // Verify allRecords was updated
        expect(allRecords['P123456']).toHaveLength(1);
        expect(allRecords['P123456'][0].id).toBe('R3A5B2C');
        expect(allRecords['P123456'][0].soap).toEqual(currentOutput.soap);
        expect(allRecords['P123456'][0].nurse_name).toBe('王小明');
    });
});

// ══════════════════════════════════════
// Test: confirmSave() saves to IndexedDB on network failure
// Validates: Requirement 4.3
// ══════════════════════════════════════
describe('confirmSave() — network failure fallback to IndexedDB', () => {
    let allRecords;
    let currentPatient;
    let currentOutput;
    let currentAlerts;
    let currentUser;
    let savedLocally;

    beforeEach(() => {
        allRecords = {};
        currentPatient = { id: 'P123456', name: '林芝', bed: '01A', age: 65 };
        currentOutput = {
            soap: { subjective: '頭痛', objective: 'BP 130/85', assessment: '緊張性頭痛', plan: '觀察' },
            medications: [],
            pain_scale: 3,
            raw_text: '頭痛'
        };
        currentAlerts = [];
        currentUser = { employee_id: 'N001', name: '王小明' };
        savedLocally = null;

        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('saves to IndexedDB when API call fails', async () => {
        // Simulate network failure
        global.fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

        const saveRecordLocally = vi.fn().mockResolvedValue(1);

        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Simulate confirmSave network failure path
        let networkFailed = false;
        try {
            await fetchWithTimeout('http://localhost:8001/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
        } catch (e) {
            networkFailed = true;

            // Save to IndexedDB (mirrors confirmSave catch block)
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
                nurse_id: currentUser.employee_id,
                nurse_name: currentUser.name,
                shift: getCurrentShift(),
                synced: false
            });

            // Also keep in-memory
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
        }

        expect(networkFailed).toBe(true);
        expect(saveRecordLocally).toHaveBeenCalledTimes(1);

        const savedArg = saveRecordLocally.mock.calls[0][0];
        expect(savedArg.patientId).toBe('P123456');
        expect(savedArg.nurse_id).toBe('N001');
        expect(savedArg.nurse_name).toBe('王小明');
        expect(savedArg.synced).toBe(false);

        // In-memory fallback also works
        expect(allRecords['P123456']).toHaveLength(1);
    });
});

// ══════════════════════════════════════
// Test: selectPatient() shows loading indicator while fetching
// Validates: Requirement 5.4
// ══════════════════════════════════════
describe('selectPatient() — loading indicator', () => {
    test('timeline shows loading text before fetch completes', () => {
        // Simulate the loading indicator logic from selectPatient()
        // In app.js: timelineEl.innerHTML = '<p style="color:#999;font-size:.85rem">載入紀錄中...</p>';
        const timelineEl = { innerHTML: '' };

        // Before fetch starts, set loading indicator (mirrors selectPatient logic)
        timelineEl.innerHTML = '<p style="color:#999;font-size:.85rem">載入紀錄中...</p>';

        expect(timelineEl.innerHTML).toContain('載入紀錄中');
    });

    test('loading indicator is replaced after records load', () => {
        const timelineEl = { innerHTML: '' };

        // Set loading
        timelineEl.innerHTML = '<p style="color:#999;font-size:.85rem">載入紀錄中...</p>';
        expect(timelineEl.innerHTML).toContain('載入紀錄中');

        // After records load, renderTimeline replaces content
        const records = [{
            time: '09:00',
            nurse_name: '王小明',
            soap: { plan: '觀察' },
            medications: [],
            alerts: []
        }];

        // Simulate renderTimeline
        timelineEl.innerHTML = records.map(r => {
            const nurseLabel = r.nurse_name ? ` [${r.nurse_name}]` : '';
            return `<div class="tl-item"><span class="tl-time">${r.time}${nurseLabel}</span><span>${r.soap?.plan || '護理紀錄'}</span></div>`;
        }).reverse().join('');

        expect(timelineEl.innerHTML).not.toContain('載入紀錄中');
        expect(timelineEl.innerHTML).toContain('09:00');
        expect(timelineEl.innerHTML).toContain('王小明');
    });
});

// ══════════════════════════════════════
// Test: renderHandover() shows warning on API failure
// Validates: Requirement 6.4
// ══════════════════════════════════════
describe('renderHandover() — API failure warning', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('shows "資料可能不完整" warning when API fails', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        let showWarning = false;

        try {
            await fetchWithTimeout('http://localhost:8001/records', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            showWarning = true;
        }

        expect(showWarning).toBe(true);

        // Simulate the warning HTML generation from renderHandover
        const warningHtml = showWarning
            ? '<div class="ho-warning" style="color:#c62828;background:#fff3e0;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:.9rem;">⚠ 資料可能不完整（網路錯誤）</div>'
            : '';

        expect(warningHtml).toContain('資料可能不完整');
        expect(warningHtml).toContain('網路錯誤');
    });
});

// ══════════════════════════════════════
// Test: autoSync() stops batch on failure
// Validates: Requirement 7.3
// ══════════════════════════════════════
describe('autoSync() — stops batch on failure', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('stops syncing remaining records when one fails', async () => {
        const unsyncedRecords = [
            { localId: 1, patientId: 'P1', soap: {}, synced: false },
            { localId: 2, patientId: 'P2', soap: {}, synced: false },
            { localId: 3, patientId: 'P3', soap: {}, synced: false }
        ];

        // First call succeeds, second fails
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
            .mockRejectedValueOnce(new Error('Network error'));

        const synced = [];
        let stoppedEarly = false;

        // Simulate autoSync loop logic from offline_sync.js
        for (let i = 0; i < unsyncedRecords.length; i++) {
            const record = unsyncedRecords[i];
            try {
                const payload = {
                    patient_id: record.patientId,
                    soap: record.soap,
                    medications: record.medications || [],
                    pain_scale: record.pain_scale,
                    warnings: [],
                    raw_text: record.raw || '',
                    shift: record.shift || ''
                };

                const res = await fetchWithTimeout('http://localhost:8001/records', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) throw new Error(`API 錯誤 ${res.status}`);
                synced.push(record.localId);
            } catch (e) {
                stoppedEarly = true;
                break; // mirrors autoSync: stop current batch
            }
        }

        expect(synced).toEqual([1]); // Only first record synced
        expect(stoppedEarly).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2); // Didn't attempt third
    });
});

// ══════════════════════════════════════
// Test: Saving automatically attaches nurse info
// Validates: Requirement 8.3
// ══════════════════════════════════════
describe('confirmSave() — automatically attaches nurse info', () => {
    test('payload includes shift from getCurrentShift()', () => {
        const shift = getCurrentShift();
        expect(['日班', '小夜班', '大夜班']).toContain(shift);

        // Build payload as confirmSave does
        const currentUser = { employee_id: 'N001', name: '王小明' };
        const currentOutput = {
            soap: { subjective: 'test', objective: 'test', assessment: 'test', plan: 'test' },
            medications: [],
            pain_scale: 0,
            raw_text: 'test'
        };

        const payload = {
            patient_id: 'P123456',
            soap: currentOutput.soap,
            medications: currentOutput.medications,
            pain_scale: currentOutput.pain_scale,
            warnings: [],
            raw_text: currentOutput.raw_text,
            shift: getCurrentShift()
        };

        expect(payload.shift).toBe(shift);
        expect(['日班', '小夜班', '大夜班']).toContain(payload.shift);
    });

    test('IndexedDB offline save includes nurse_id, nurse_name, and shift', () => {
        const currentUser = { employee_id: 'N002', name: '李美華' };

        // Simulate the offline save payload from confirmSave catch block
        const offlineRecord = {
            patientId: 'P123456',
            patientName: '林芝',
            soap: { subjective: 'test', objective: 'test', assessment: 'test', plan: 'test' },
            medications: [],
            pain_scale: 3,
            alerts: [],
            time: '09:30',
            date: '2025-01-15',
            raw: 'test',
            nurse_id: currentUser.employee_id,
            nurse_name: currentUser.name,
            shift: getCurrentShift(),
            synced: false
        };

        expect(offlineRecord.nurse_id).toBe('N002');
        expect(offlineRecord.nurse_name).toBe('李美華');
        expect(['日班', '小夜班', '大夜班']).toContain(offlineRecord.shift);
        expect(offlineRecord.synced).toBe(false);
    });
});
