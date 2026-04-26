// Feature: safety-ui-layer, Property 7: Drug interaction detection with alias resolution
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { checkDrugInteractions } from '../safety_check.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_local = dirname(fileURLToPath(import.meta.url));
const drugDB = JSON.parse(readFileSync(join(__dirname_local, '..', 'drug_safety_db.json'), 'utf-8'));

// Build a set of all known interacting pairs (canonical names, lowercased)
const knownPairs = new Set();
for (const ix of drugDB.interactions) {
  knownPairs.add(`${ix.drug1.toLowerCase()}|${ix.drug2.toLowerCase()}`);
  knownPairs.add(`${ix.drug2.toLowerCase()}|${ix.drug1.toLowerCase()}`);
}

// Build alias → canonical map
const aliasToCanonical = {};
for (const drug of drugDB.drugs) {
  aliasToCanonical[drug.name.toLowerCase()] = drug.name.toLowerCase();
  for (const alias of drug.aliases) {
    aliasToCanonical[alias.toLowerCase()] = drug.name.toLowerCase();
  }
}

// All drug names and aliases
const allNames = Object.keys(aliasToCanonical);

describe('Property 7: Drug interaction detection with alias resolution', () => {
  test('all known interaction pairs produce alerts regardless of name/alias used', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...drugDB.interactions),
        (interaction) => {
          // Find all names (canonical + aliases) for drug1 and drug2
          const drug1Entry = drugDB.drugs.find(d => d.name.toLowerCase() === interaction.drug1.toLowerCase());
          const drug2Entry = drugDB.drugs.find(d => d.name.toLowerCase() === interaction.drug2.toLowerCase());
          if (!drug1Entry || !drug2Entry) return;

          const names1 = [drug1Entry.name, ...drug1Entry.aliases];
          const names2 = [drug2Entry.name, ...drug2Entry.aliases];

          // Pick random name from each
          const name1 = names1[Math.floor(Math.random() * names1.length)];
          const name2 = names2[Math.floor(Math.random() * names2.length)];

          const meds = [{ name: name1 }, { name: name2 }];
          const alerts = checkDrugInteractions(meds, drugDB);

          expect(alerts.length).toBeGreaterThanOrEqual(1);
          expect(alerts[0].type).toBe('drug_interaction');
          expect(alerts[0].severity).toBe(interaction.severity);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('non-interacting drug pairs produce no alerts', () => {
    // Find pairs that are NOT in the interactions list
    const nonInteractingPairs = [];
    for (let i = 0; i < drugDB.drugs.length; i++) {
      for (let j = i + 1; j < drugDB.drugs.length; j++) {
        const d1 = drugDB.drugs[i].name.toLowerCase();
        const d2 = drugDB.drugs[j].name.toLowerCase();
        if (!knownPairs.has(`${d1}|${d2}`)) {
          nonInteractingPairs.push([drugDB.drugs[i].name, drugDB.drugs[j].name]);
        }
      }
    }

    if (nonInteractingPairs.length === 0) return;

    fc.assert(
      fc.property(
        fc.constantFrom(...nonInteractingPairs),
        ([name1, name2]) => {
          const meds = [{ name: name1 }, { name: name2 }];
          const alerts = checkDrugInteractions(meds, drugDB);
          expect(alerts.length).toBe(0);
        }
      ),
      { numRuns: Math.min(100, nonInteractingPairs.length) }
    );
  });
});
