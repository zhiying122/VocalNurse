import { describe, test, expect, beforeAll } from 'vitest';
import { checkDrugInteractions, findDrug } from '../safety_check.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const drugDB = JSON.parse(readFileSync(join(__dirname_local, '..', 'drug_safety_db.json'), 'utf-8'));

describe('checkDrugInteractions', () => {
  test('returns empty array when medications is null or undefined', () => {
    expect(checkDrugInteractions(null, drugDB)).toEqual([]);
    expect(checkDrugInteractions(undefined, drugDB)).toEqual([]);
  });

  test('returns empty array when fewer than 2 medications', () => {
    expect(checkDrugInteractions([], drugDB)).toEqual([]);
    expect(checkDrugInteractions([{ name: 'Warfarin' }], drugDB)).toEqual([]);
  });

  test('returns empty array when drugDB has no interactions', () => {
    const meds = [{ name: 'Warfarin' }, { name: 'Aspirin' }];
    expect(checkDrugInteractions(meds, { drugs: drugDB.drugs })).toEqual([]);
    expect(checkDrugInteractions(meds, { drugs: drugDB.drugs, interactions: [] })).toEqual([]);
  });

  test('detects known Warfarin + Aspirin interaction', () => {
    const meds = [{ name: 'Warfarin' }, { name: 'Aspirin' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('drug_interaction');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].item).toBe('Warfarin + Aspirin');
    expect(alerts[0].detected).toBe('Warfarin 與 Aspirin 併用');
    expect(alerts[0].range).toBe('禁止或需謹慎併用');
    expect(alerts[0].message).toContain('出血');
  });

  test('detects interaction using aliases (case-insensitive)', () => {
    const meds = [{ name: '華法林' }, { name: '阿斯匹靈' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('drug_interaction');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].item).toBe('華法林 + 阿斯匹靈');
  });

  test('detects interaction regardless of order', () => {
    const meds = [{ name: 'Aspirin' }, { name: 'Warfarin' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('drug_interaction');
  });

  test('detects multiple interactions among multiple medications', () => {
    const meds = [
      { name: 'Warfarin' },
      { name: 'Aspirin' },
      { name: 'Ibuprofen' }
    ];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(2);
    expect(alerts.every(a => a.type === 'drug_interaction')).toBe(true);
  });

  test('returns no alerts for non-interacting medications', () => {
    const meds = [{ name: 'Acetaminophen' }, { name: 'Amoxicillin' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(0);
  });

  test('detects warning-level interaction (Metformin + Furosemide)', () => {
    const meds = [{ name: 'Metformin' }, { name: 'Furosemide' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  test('handles case-insensitive canonical name matching', () => {
    const meds = [{ name: 'warfarin' }, { name: 'aspirin' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('drug_interaction');
  });

  test('handles alias mixed with canonical name', () => {
    const meds = [{ name: 'Coumadin' }, { name: 'Aspirin' }];
    const alerts = checkDrugInteractions(meds, drugDB);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('drug_interaction');
    expect(alerts[0].item).toBe('Coumadin + Aspirin');
  });
});
