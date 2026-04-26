// Feature: safety-ui-layer, Property 1: Dose parser round-trip
// Feature: safety-ui-layer, Property 2: Dose parser rejects invalid input
// Feature: safety-ui-layer, Property 3: Dose parser non-negativity invariant
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { parseDose, formatDose } from '../safety_check.js';

describe('Property 1: Dose parser round-trip', () => {
  test('parseDose → formatDose → parseDose produces same mg value for all units', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 10000, noNaN: true }),
        fc.constantFrom('mg', 'g', 'mcg', 'μg'),
        (dose, unit) => {
          const mg = parseDose(dose.toString(), unit);
          if (mg === null || mg === 0) return; // skip edge cases
          const formatted = formatDose(mg, unit);
          const reparsed = parseDose(formatted, unit);
          expect(reparsed).toBeCloseTo(mg, 6);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('round-trip with integer doses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom('mg', 'g', 'mcg', 'μg'),
        (dose, unit) => {
          const mg = parseDose(dose.toString(), unit);
          if (mg === null) return;
          const formatted = formatDose(mg, unit);
          const reparsed = parseDose(formatted, unit);
          expect(reparsed).toBeCloseTo(mg, 6);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 2: Dose parser rejects invalid input', () => {
  test('null/undefined/empty returns null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined, ''),
        (input) => {
          expect(parseDose(input)).toBeNull();
        }
      )
    );
  });

  test('non-numeric strings return null', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => s.length > 0 && !/\d/.test(s)),
        (input) => {
          expect(parseDose(input)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Dose parser non-negativity invariant', () => {
  test('valid parse results are always >= 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100000, noNaN: true }),
        fc.constantFrom('mg', 'g', 'mcg', 'μg', ''),
        (dose, unit) => {
          const result = parseDose(dose.toString(), unit);
          if (result !== null) {
            expect(result).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('negative values return null', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100000, max: -0.001, noNaN: true }),
        fc.constantFrom('mg', 'g', 'mcg', 'μg'),
        (dose, unit) => {
          expect(parseDose(dose.toString(), unit)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
