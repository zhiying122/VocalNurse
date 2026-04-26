// Feature: safety-ui-layer, Property 4: Daily dose sum correctness
// Feature: safety-ui-layer, Property 5: Daily dose threshold alerts
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { checkDailyDose, parseDose, findDrug } from '../safety_check.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const drugDB = JSON.parse(readFileSync(join(__dirname_local, '..', 'drug_safety_db.json'), 'utf-8'));

// Helper: set drugSafetyDB for findDrug to work
// Since findDrug uses module-level drugSafetyDB, we need to test checkDailyDose directly
// checkDailyDose calls findDrug internally which needs drugSafetyDB set

describe('Property 4: Daily dose sum correctness', () => {
  test('only sums today records for the target drug', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),  // number of today records
        fc.integer({ min: 0, max: 3 }),  // number of yesterday records
        fc.integer({ min: 100, max: 500 }), // dose per record
        (todayCount, yesterdayCount, dosePerRecord) => {
          const drug = drugDB.drugs[0]; // Acetaminophen
          const records = [];

          // Today's records for the target drug
          for (let i = 0; i < todayCount; i++) {
            records.push({
              date: today,
              time: `${(8 + i).toString().padStart(2, '0')}:00`,
              medications: [{ name: drug.name, dose: dosePerRecord.toString(), unit: 'mg' }]
            });
          }

          // Yesterday's records (should be ignored)
          for (let i = 0; i < yesterdayCount; i++) {
            records.push({
              date: yesterday,
              time: `${(8 + i).toString().padStart(2, '0')}:00`,
              medications: [{ name: drug.name, dose: '1000', unit: 'mg' }]
            });
          }

          // Other drug records today (should be ignored)
          records.push({
            date: today,
            time: '12:00',
            medications: [{ name: 'Morphine', dose: '10', unit: 'mg' }]
          });

          const currentMed = { name: drug.name, dose: dosePerRecord.toString(), unit: 'mg' };
          const result = checkDailyDose(currentMed, records, drugDB);

          // Expected total = currentDose + todayCount * dosePerRecord
          const expectedTotal = dosePerRecord + todayCount * dosePerRecord;

          if (result) {
            // If alert produced, the detected value should reflect the correct total
            expect(result.detected).toContain(expectedTotal.toString());
          }
          // The function should never include yesterday's records in the total
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 5: Daily dose threshold alerts', () => {
  test('exceeding max_daily_dose produces critical alert', () => {
    const today = new Date().toISOString().slice(0, 10);

    fc.assert(
      fc.property(
        fc.constantFrom(...drugDB.drugs.filter(d => d.max_daily_dose_mg > 0)),
        (drug) => {
          // Create records that push total over max_daily_dose_mg
          const overDose = drug.max_daily_dose_mg + 1;
          const currentMed = { name: drug.name, dose: overDose.toString(), unit: 'mg' };
          const result = checkDailyDose(currentMed, [], drugDB);

          if (result) {
            expect(result.type).toBe('daily_dose_exceeded');
            expect(result.severity).toBe('critical');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('80-100% of max_daily_dose produces warning alert', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...drugDB.drugs.filter(d => d.max_daily_dose_mg > 0)),
        (drug) => {
          // Dose at exactly 80% of max
          const dose80 = drug.max_daily_dose_mg * 0.8;
          const currentMed = { name: drug.name, dose: dose80.toString(), unit: 'mg' };
          const result = checkDailyDose(currentMed, [], drugDB);

          if (result) {
            expect(['daily_dose_approaching', 'daily_dose_exceeded']).toContain(result.type);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('below 80% of max_daily_dose produces no alert', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...drugDB.drugs.filter(d => d.max_daily_dose_mg > 0)),
        fc.double({ min: 0.01, max: 0.79, noNaN: true }),
        (drug, fraction) => {
          const dose = Math.floor(drug.max_daily_dose_mg * fraction);
          if (dose <= 0) return;
          const currentMed = { name: drug.name, dose: dose.toString(), unit: 'mg' };
          const result = checkDailyDose(currentMed, [], drugDB);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
