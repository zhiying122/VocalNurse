// Feature: safety-ui-layer, Property 10: Drug safety DB JSON round-trip
// Feature: safety-ui-layer, Property 11: Drug safety DB schema completeness
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const drugDB = JSON.parse(readFileSync(join(__dirname_local, '..', 'drug_safety_db.json'), 'utf-8'));

describe('Property 10: Drug safety DB JSON round-trip', () => {
  test('every drug entry survives JSON round-trip', () => {
    for (const drug of drugDB.drugs) {
      const roundTripped = JSON.parse(JSON.stringify(drug));
      expect(roundTripped).toEqual(drug);
    }
  });

  test('every interaction entry survives JSON round-trip', () => {
    for (const interaction of drugDB.interactions) {
      const roundTripped = JSON.parse(JSON.stringify(interaction));
      expect(roundTripped).toEqual(interaction);
    }
  });

  test('entire DB survives JSON round-trip', () => {
    const roundTripped = JSON.parse(JSON.stringify(drugDB));
    expect(roundTripped).toEqual(drugDB);
  });
});

describe('Property 11: Drug safety DB schema completeness', () => {
  test('DB has at least 20 drugs', () => {
    expect(drugDB.drugs.length).toBeGreaterThanOrEqual(20);
  });

  test('DB has at least 5 interactions', () => {
    expect(drugDB.interactions.length).toBeGreaterThanOrEqual(5);
  });

  test('every drug has all required fields with correct types', () => {
    for (const drug of drugDB.drugs) {
      expect(typeof drug.name).toBe('string');
      expect(Array.isArray(drug.aliases)).toBe(true);
      drug.aliases.forEach(a => expect(typeof a).toBe('string'));
      expect(typeof drug.max_single_dose_mg).toBe('number');
      expect(drug.max_single_dose_mg).toBeGreaterThanOrEqual(0);
      expect(typeof drug.max_daily_dose_mg).toBe('number');
      expect(drug.max_daily_dose_mg).toBeGreaterThanOrEqual(0);
      expect(typeof drug.common_dose_mg).toBe('number');
      expect(drug.common_dose_mg).toBeGreaterThanOrEqual(0);
      expect(typeof drug.unit).toBe('string');
      expect(Array.isArray(drug.route)).toBe(true);
      drug.route.forEach(r => expect(typeof r).toBe('string'));
      expect(typeof drug.warning).toBe('string');
    }
  });

  test('every interaction has all required fields with correct types', () => {
    for (const ix of drugDB.interactions) {
      expect(typeof ix.drug1).toBe('string');
      expect(typeof ix.drug2).toBe('string');
      expect(['critical', 'warning']).toContain(ix.severity);
      expect(typeof ix.description).toBe('string');
    }
  });

  test('vital_signs includes respiratory_rate', () => {
    expect(drugDB.vital_signs).toHaveProperty('respiratory_rate');
    expect(typeof drugDB.vital_signs.respiratory_rate.min).toBe('number');
    expect(typeof drugDB.vital_signs.respiratory_rate.max).toBe('number');
  });
});
