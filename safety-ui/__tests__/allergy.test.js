/**
 * checkAllergy 過敏檢查測試
 *
 * 涵蓋：
 * 1. 直接名稱比對
 * 2. 藥物類別比對（NSAIDs、Cephalosporins、Sulfa drugs 等）
 * 3. 交叉過敏（Penicillin ↔ Cephalosporins）
 * 4. 無過敏時不觸發
 * 5. NKA（No Known Allergies）不觸發
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { checkAllergy, findDrug } from '../safety_check.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_local = dirname(fileURLToPath(import.meta.url));

// 模擬 drugSafetyDB 全域變數（safety_check.js 使用 module-level drugSafetyDB）
// 透過直接設定 global.drugSafetyDB 來注入測試資料
const drugDB = JSON.parse(readFileSync(join(__dirname_local, '..', 'drug_safety_db.json'), 'utf-8'));

// 模擬 currentPatient 全域變數
function withPatient(allergies, fn) {
    global.currentPatient = { name: '測試病患', age: 50, allergies };
    global.drugSafetyDB = drugDB;
    try { return fn(); }
    finally { global.currentPatient = null; }
}

describe('checkAllergy — 直接名稱比對', () => {
    test('藥物名稱直接包含過敏原 → 觸發警示', () => {
        const alert = withPatient(['Aspirin'], () =>
            checkAllergy({ name: 'Aspirin', dose: '100', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.type).toBe('allergy');
        expect(alert.severity).toBe('critical');
        expect(alert.item).toBe('Aspirin');
    });

    test('大小寫不敏感比對', () => {
        const alert = withPatient(['aspirin'], () =>
            checkAllergy({ name: 'ASPIRIN', dose: '100', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.type).toBe('allergy');
    });

    test('無過敏紀錄 → 不觸發', () => {
        const alert = withPatient([], () =>
            checkAllergy({ name: 'Aspirin', dose: '100', unit: 'mg' })
        );
        expect(alert).toBeNull();
    });

    test('NKA 不觸發任何警示', () => {
        const alert = withPatient(['NKA'], () =>
            checkAllergy({ name: 'Aspirin', dose: '100', unit: 'mg' })
        );
        expect(alert).toBeNull();
    });
});

describe('checkAllergy — NSAIDs 類別比對', () => {
    test('NSAIDs 過敏 + Voltaren → 觸發', () => {
        const alert = withPatient(['NSAIDs'], () =>
            checkAllergy({ name: 'Voltaren', dose: '25', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('NSAIDs');
    });

    test('NSAIDs 過敏 + Ibuprofen → 觸發', () => {
        const alert = withPatient(['NSAIDs'], () =>
            checkAllergy({ name: 'Ibuprofen', dose: '400', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });

    test('NSAIDs 過敏 + Ketorolac → 觸發', () => {
        const alert = withPatient(['NSAIDs'], () =>
            checkAllergy({ name: 'Ketorolac', dose: '30', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });

    test('NSAIDs 過敏 + Acetaminophen（非 NSAIDs）→ 不觸發', () => {
        const alert = withPatient(['NSAIDs'], () =>
            checkAllergy({ name: 'Acetaminophen', dose: '500', unit: 'mg' })
        );
        expect(alert).toBeNull();
    });
});

describe('checkAllergy — Cephalosporins 類別比對', () => {
    test('Cephalosporins 過敏 + Ceftriaxone → 觸發', () => {
        const alert = withPatient(['Cephalosporins'], () =>
            checkAllergy({ name: 'Ceftriaxone', dose: '1000', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('Cephalosporins');
        expect(alert.message).toContain('Ceftriaxone');
    });

    test('Cephalosporins 過敏 + Cefazolin → 觸發', () => {
        const alert = withPatient(['Cephalosporins'], () =>
            checkAllergy({ name: 'Cefazolin', dose: '1000', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });

    test('Cephalosporins 過敏 + Amoxicillin（非 Cephalosporin）→ 不觸發直接警示', () => {
        // Amoxicillin 是 Penicillin 類，不是 Cephalosporin，不應直接觸發 Cephalosporins 過敏
        const alert = withPatient(['Cephalosporins'], () =>
            checkAllergy({ name: 'Amoxicillin', dose: '500', unit: 'mg' })
        );
        // 可能觸發交叉過敏警示，但不應是直接類別比對
        if (alert) {
            expect(alert.message).toContain('交叉過敏');
        }
    });
});

describe('checkAllergy — Penicillin 類別比對', () => {
    test('Penicillin 過敏 + Ampicillin → 觸發', () => {
        const alert = withPatient(['Penicillin'], () =>
            checkAllergy({ name: 'Ampicillin', dose: '500', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });

    test('Penicillin 過敏 + Amoxicillin → 觸發', () => {
        const alert = withPatient(['Penicillin'], () =>
            checkAllergy({ name: 'Amoxicillin', dose: '500', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });
});

describe('checkAllergy — 交叉過敏（Penicillin ↔ Cephalosporins）', () => {
    test('Penicillin 過敏 + Ceftriaxone → 觸發交叉過敏警示', () => {
        const alert = withPatient(['Penicillin'], () =>
            checkAllergy({ name: 'Ceftriaxone', dose: '1000', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('交叉過敏');
    });

    test('Cephalosporins 過敏 + Ampicillin → 觸發交叉過敏警示', () => {
        const alert = withPatient(['Cephalosporins'], () =>
            checkAllergy({ name: 'Ampicillin', dose: '500', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('交叉過敏');
    });
});

describe('checkAllergy — Sulfa drugs 類別比對', () => {
    test('Sulfa drugs 過敏 + Sulfamethoxazole → 觸發', () => {
        const alert = withPatient(['Sulfa drugs'], () =>
            checkAllergy({ name: 'Sulfamethoxazole', dose: '800', unit: 'mg' })
        );
        expect(alert).not.toBeNull();
        expect(alert.severity).toBe('critical');
    });

    test('Sulfa drugs 過敏 + Amoxicillin（非 Sulfa）→ 不觸發', () => {
        const alert = withPatient(['Sulfa drugs'], () =>
            checkAllergy({ name: 'Amoxicillin', dose: '500', unit: 'mg' })
        );
        expect(alert).toBeNull();
    });
});

describe('checkAllergy — currentPatient 為 null', () => {
    test('currentPatient 為 null → 不觸發', () => {
        global.currentPatient = null;
        const alert = checkAllergy({ name: 'Aspirin', dose: '100', unit: 'mg' });
        expect(alert).toBeNull();
    });
});
