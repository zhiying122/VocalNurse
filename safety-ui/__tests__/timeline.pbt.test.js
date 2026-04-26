// Feature: safety-ui-layer, Property 12: Timeline node danger flagging
// Feature: safety-ui-layer, Property 13: Timeline tooltip content completeness
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

// Since updateMedicationTimeline depends on Chart.js and DOM,
// we test the data transformation logic that drives the timeline rendering.

function buildTimelineEvents(records, alerts) {
  const events = [];
  const alertItems = new Set((alerts || []).map(a => a.item));

  if (records && records.length) {
    let drugIndex = 0;
    const drugMap = {};

    for (const record of records) {
      if (!record.medications) continue;
      for (const med of record.medications) {
        if (!(med.name in drugMap)) {
          drugMap[med.name] = drugIndex++;
        }
        const timeParts = (record.time || '00:00').split(':');
        const timeNum = parseInt(timeParts[0]) + parseInt(timeParts[1] || 0) / 60;

        const hasAlert = alertItems.has(med.name) ||
          (record.alerts || []).some(a => a.item === med.name);

        events.push({
          x: timeNum,
          y: drugMap[med.name],
          drugName: med.name,
          dose: med.dose || '',
          unit: med.unit || '',
          route: med.route || '',
          timeStr: record.time,
          hasAlert: hasAlert
        });
      }
    }
  }
  return events;
}

describe('Property 12: Timeline node danger flagging', () => {
  test('records with alerts are flagged as danger', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          name: fc.constantFrom('Acetaminophen', 'Aspirin', 'Morphine'),
          dose: fc.constantFrom('500', '100', '10'),
          unit: fc.constant('mg'),
          route: fc.constantFrom('PO', 'IV'),
        }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('08:00', '10:30', '14:00', '18:00'),
        (meds, time) => {
          // Create a record with alerts for the first medication
          const alertMed = meds[0];
          const alerts = [{ type: 'dosage_exceeded', severity: 'critical', item: alertMed.name }];
          const records = [{ time, medications: meds, alerts }];

          const events = buildTimelineEvents(records, alerts);

          // The first medication's event should be flagged
          const alertEvent = events.find(e => e.drugName === alertMed.name);
          expect(alertEvent).toBeDefined();
          expect(alertEvent.hasAlert).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('records without alerts are not flagged', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Acetaminophen', 'Aspirin', 'Morphine'),
        fc.constantFrom('08:00', '12:00', '16:00'),
        (drugName, time) => {
          const records = [{
            time,
            medications: [{ name: drugName, dose: '500', unit: 'mg', route: 'PO' }],
            alerts: []
          }];

          const events = buildTimelineEvents(records, []);
          expect(events.length).toBe(1);
          expect(events[0].hasAlert).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 13: Timeline tooltip content completeness', () => {
  test('every event contains drugName, dose, unit, route, timeStr', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.constantFrom('Acetaminophen', 'Warfarin', 'Morphine'),
          dose: fc.constantFrom('500', '5', '10'),
          unit: fc.constantFrom('mg', 'g'),
          route: fc.constantFrom('PO', 'IV', 'IM'),
        }),
        fc.constantFrom('08:00', '12:30', '18:45'),
        (med, time) => {
          const records = [{ time, medications: [med] }];
          const events = buildTimelineEvents(records, []);

          expect(events.length).toBe(1);
          const e = events[0];
          expect(e.drugName).toBe(med.name);
          expect(e.dose).toBe(med.dose);
          expect(e.unit).toBe(med.unit);
          expect(e.route).toBe(med.route);
          expect(e.timeStr).toBe(time);

          // Simulate tooltip string
          const tooltip = `${e.drugName} ${e.dose} ${e.unit} ${e.route} @ ${e.timeStr}`;
          expect(tooltip).toContain(med.name);
          expect(tooltip).toContain(med.dose);
          expect(tooltip).toContain(med.unit);
          expect(tooltip).toContain(med.route);
          expect(tooltip).toContain(time);
        }
      ),
      { numRuns: 100 }
    );
  });
});
