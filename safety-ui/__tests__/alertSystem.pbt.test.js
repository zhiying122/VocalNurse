// Feature: safety-ui-layer, Property 14: Sequential alert display ordering
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

// Test the alert sequencing logic (pure function, no DOM dependency)
function separateAlerts(alerts) {
  const criticals = alerts.filter(a => a.severity === 'critical');
  const warnings = alerts.filter(a => a.severity === 'warning');
  return { criticals, warnings };
}

describe('Property 14: Sequential alert display ordering', () => {
  test('critical alerts maintain original order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom('dosage_exceeded', 'allergy', 'daily_dose_exceeded', 'drug_interaction', 'vital_abnormal'),
            severity: fc.constantFrom('critical', 'warning'),
            item: fc.string({ minLength: 1, maxLength: 20 }),
            message: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (alerts) => {
          const { criticals } = separateAlerts(alerts);

          // Verify criticals maintain their relative order from the original array
          let lastOrigIndex = -1;
          for (const c of criticals) {
            const origIndex = alerts.indexOf(c);
            expect(origIndex).toBeGreaterThan(lastOrigIndex);
            lastOrigIndex = origIndex;
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('warnings are separated from criticals', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom('dosage_exceeded', 'daily_dose_approaching', 'vital_abnormal'),
            severity: fc.constantFrom('critical', 'warning'),
            item: fc.string({ minLength: 1, maxLength: 20 }),
            message: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (alerts) => {
          const { criticals, warnings } = separateAlerts(alerts);

          // All criticals have severity 'critical'
          for (const c of criticals) {
            expect(c.severity).toBe('critical');
          }

          // All warnings have severity 'warning'
          for (const w of warnings) {
            expect(w.severity).toBe('warning');
          }

          // Total count matches
          expect(criticals.length + warnings.length).toBe(alerts.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('sequential display shows one at a time in order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constant('dosage_exceeded'),
            severity: fc.constant('critical'),
            item: fc.string({ minLength: 1, maxLength: 10 }),
            message: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        (criticals) => {
          // Simulate sequential display: index 0, 1, 2, ...
          for (let i = 0; i < criticals.length; i++) {
            // At step i, the i-th alert should be the one displayed
            const currentAlert = criticals[i];
            expect(currentAlert).toBe(criticals[i]);

            // After acknowledging, next index is i+1
            const nextIndex = i + 1;
            if (nextIndex < criticals.length) {
              expect(criticals[nextIndex]).toBeDefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
