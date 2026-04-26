# Implementation Plan: Safety & UI Layer 增強

## Overview

Incrementally enhance the VoiceNursy safety-ui frontend: refactor core modules to ES Modules for testability, expand the drug safety database, strengthen parsers and safety checks, add medication timeline visualization, improve alert UX, accessibility, responsive design, API resilience, and establish Vitest + fast-check test infrastructure. Each task builds on the previous, wiring everything together at the end.

## Tasks

- [x] 1. Set up test infrastructure and ES Module refactoring
  - [x] 1.1 Initialize npm project and install Vitest + fast-check
    - Create `safety-ui/package.json` with `vitest` and `fast-check` as dev dependencies
    - Create `safety-ui/vitest.config.js` configured for the `__tests__/` directory
    - _Requirements: 10.1_

  - [x] 1.2 Refactor `safety_check.js` to support ES Module exports
    - Add conditional `export` at the bottom of `safety_check.js` for: `parseDose`, `formatDose`, `findDrug`, `checkDrugDosage`, `checkDailyDose`, `checkDrugInteractions`, `checkAllergy`, `checkVitalSigns`, `checkSafety`
    - Ensure browser global access is preserved (conditional export pattern)
    - _Requirements: 10.1_

  - [x] 1.3 Refactor `charts.js` to support ES Module exports
    - Add conditional `export` for: `initPainChart`, `updatePainChart`, `initMedicationTimeline`, `updateMedicationTimeline`
    - _Requirements: 10.1_

- [x] 2. Expand drug safety database
  - [x] 2.1 Add drugs to reach 20+ entries and add interactions array
    - Expand `safety-ui/drug_safety_db.json` to include at least 20 drug entries with all required fields (name, aliases, max_single_dose_mg, max_daily_dose_mg, common_dose_mg, unit, route, warning)
    - Add `interactions` array with at least 5 drug interaction records (drug1, drug2, severity, description)
    - Ensure `vital_signs` section includes `respiratory_rate` (already present, verify)
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 2.2 Write property tests for drug safety DB schema and round-trip
    - **Property 10: Drug safety DB JSON round-trip** — `JSON.parse(JSON.stringify(entry))` deep equals original
    - **Property 11: Drug safety DB schema completeness** — all required fields present with correct types
    - **Validates: Requirements 4.3, 4.4**

- [x] 3. Enhance dose parser with mcg/μg support and formatDose
  - [x] 3.1 Implement enhanced `parseDose` and new `formatDose` in `safety_check.js`
    - Update `parseDose(dose, unit)` to handle "mcg" and "μg" units (divide by 1000), "g" (multiply by 1000), reject negative values, handle edge cases
    - Add `formatDose(mg, targetUnit)` for reverse conversion
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x]* 3.2 Write property tests for dose parser
    - **Property 1: Dose parser round-trip** — parseDose → formatDose → parseDose produces same mg value
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.6**

  - [x]* 3.3 Write property tests for dose parser invalid input and non-negativity
    - **Property 2: Dose parser rejects invalid input** — null/undefined/empty/non-numeric returns null
    - **Property 3: Dose parser non-negativity invariant** — valid parse results are ≥ 0
    - **Validates: Requirements 5.4, 5.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement daily cumulative dose tracking
  - [x] 5.1 Implement `checkDailyDose` in `safety_check.js`
    - Add `checkDailyDose(medication, patientRecords, drugDB)` that sums today's (calendar day 00:00–23:59) doses for the same drug (matching by name and aliases)
    - Return "daily_dose_exceeded" alert (severity "critical") when cumulative > max_daily_dose_mg
    - Return "daily_dose_approaching" alert (severity "warning") when cumulative ≥ 80% of max_daily_dose_mg
    - Integrate into `checkSafety()` flow, passing patient records from `allRecords`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x]* 5.2 Write property tests for daily dose tracking
    - **Property 4: Daily dose sum correctness** — only sums today's records for the target drug
    - **Property 5: Daily dose threshold alerts** — correct alert types based on cumulative vs max_daily_dose_mg
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 6. Implement drug interaction checking
  - [x] 6.1 Implement `checkDrugInteractions` in `safety_check.js`
    - Add `checkDrugInteractions(medications, drugDB)` that checks all pairwise combinations against `drugDB.interactions`
    - Match using canonical names and aliases (case-insensitive)
    - Return "drug_interaction" alerts with severity and description from the DB
    - Integrate into `checkSafety()` flow
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x]* 6.2 Write property tests for drug interaction detection
    - **Property 7: Drug interaction detection with alias resolution** — known interactions produce alerts, unknown pairs do not
    - **Validates: Requirements 3.2, 3.3, 3.4**

- [x] 7. Enhance vital sign parser with RR support
  - [x] 7.1 Add RR parsing to `checkVitalSigns` in `safety_check.js`
    - Add regex pattern for `RR\s*(\d+)` to extract respiratory rate
    - Produce "vital_abnormal" alert when RR is outside the defined range in `vital_signs.respiratory_rate`
    - _Requirements: 6.1, 6.5_

  - [x]* 7.2 Write property tests for vital sign parser
    - **Property 8: Vital sign extraction completeness** — all present vital signs extracted and alerts produced for out-of-range values
    - **Property 9: Vital sign parser graceful handling** — no vital sign patterns returns empty array without error
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x]* 9. Write property test for single dose threshold alerts
  - **Property 6: Single dose threshold alerts** — doses exceeding max_single_dose_mg produce "dosage_exceeded" alert; doses at or below do not
  - **Validates: Requirements 10.3**

- [x] 10. Implement medication timeline visualization
  - [x] 10.1 Add medication timeline canvas to `index.html` and implement in `charts.js`
    - Add a `<canvas id="med-timeline">` element in the side panel below the pain chart
    - Implement `initMedicationTimeline(canvas)` using Chart.js scatter chart with time x-axis
    - Implement `updateMedicationTimeline(records, alerts)` to render medication events as nodes
    - Normal nodes: blue (`#2d3a8c`), alert nodes: red (`#c62828`) with ⚠️ icon
    - Tooltip shows: drug name, dose, unit, route, time
    - Show "尚無給藥紀錄" placeholder when no records exist
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 10.2 Wire timeline updates into `app.js`
    - Call `updateMedicationTimeline()` on patient selection and after `confirmSave()`
    - Ensure real-time update without page reload
    - _Requirements: 1.5_

  - [x]* 10.3 Write property tests for timeline node rendering
    - **Property 12: Timeline node danger flagging** — records with alerts flagged as danger (red)
    - **Property 13: Timeline tooltip content completeness** — tooltip contains drug name, dose, unit, route, time
    - **Validates: Requirements 1.2, 1.3**

- [x] 11. Implement sequential alert display and warning banner
  - [x] 11.1 Implement sequential critical alert display in `app.js`
    - Refactor `showAlert` to `showAlerts(alerts)` that separates critical vs warning alerts
    - Critical alerts: display one at a time via `showAlertSequence(criticals, index)`; `ackAlert` advances to next
    - Add alert sound effect (≤ 500ms) on critical alert display
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 11.2 Implement warning yellow banner in `app.js` and `styles.css`
    - Add `showWarningBanner(warnings)` that displays a yellow banner above SOAP cards for severity "warning" alerts
    - Banner should not block user interaction (dismissible but non-modal)
    - Add `.warning-banner` styles in `styles.css` (yellow background, readable text)
    - _Requirements: 7.5_

  - [x]* 11.3 Write property test for sequential alert ordering
    - **Property 14: Sequential alert display ordering** — alerts presented one at a time in original order
    - **Validates: Requirements 7.4**

- [x] 12. Implement accessibility improvements
  - [x] 12.1 Add ARIA labels and roles to `index.html`
    - Add `aria-label` or `aria-labelledby` to all interactive elements (buttons, inputs, contenteditable areas)
    - Ensure logical tab order with `tabindex` where needed
    - Add `aria-live="polite"` region for SOAP card content updates
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 12.2 Implement focus trap for alert overlay in `app.js`
    - Add `trapFocus(overlayElement)` that constrains Tab/Shift+Tab within the alert overlay
    - Activate focus trap when alert overlay is shown, release when dismissed
    - _Requirements: 8.3_

  - [x] 12.3 Audit and fix color contrast in `styles.css`
    - Review all text/background color combinations for WCAG 2.1 AA compliance (≥ 4.5:1 contrast ratio)
    - Fix any failing combinations (e.g., light gray text on white backgrounds)
    - _Requirements: 8.4_

- [x] 13. Implement responsive design improvements
  - [x] 13.1 Add tablet and mobile breakpoints to `styles.css`
    - At `< 768px`: switch main content to single-column stacked layout, move side panel below SOAP cards
    - At `< 480px`: convert top navigation to collapsible hamburger menu
    - Ensure record button touch target is at least 44×44px on all screen sizes
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 13.2 Add hamburger menu toggle to `index.html` and `app.js`
    - Add hamburger button element (hidden on desktop, visible on mobile)
    - Implement toggle logic in `app.js` to show/hide nav items
    - _Requirements: 9.4_

- [x] 14. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement API timeout/retry and save failure handling
  - [x] 15.1 Implement `fetchWithTimeout` in `app.js`
    - Add `fetchWithTimeout(url, options, timeout=10000)` using `AbortController`
    - Replace existing `fetch` calls in `doLogin`, `doRegister`, `processBrain`, `loadPatients`, `submitPatient` with `fetchWithTimeout`
    - Show user-friendly error messages for HTTP 4xx/5xx (parse `detail` field)
    - Show timeout prompt with retry option when request exceeds 10 seconds
    - _Requirements: 11.1, 11.4_

  - [x] 15.2 Implement save failure handling with retry and offline options
    - Update `confirmSave()` to handle network errors: show failure prompt with "重試" and "離線暫存" buttons
    - Disable save button during save animation to prevent double-submit
    - On save success: play checkmark animation (2–3s), then clear SOAP cards
    - On offline save: call `saveRecordLocally()` and show confirmation
    - _Requirements: 11.2, 11.3, 12.1, 12.2, 12.3, 12.4_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1–14)
- Unit tests validate specific examples and edge cases
- The codebase remains vanilla HTML/CSS/JS — no framework dependencies introduced
- ES Module conditional exports ensure both browser and Vitest compatibility
