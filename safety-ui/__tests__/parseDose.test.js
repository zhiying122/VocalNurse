import { describe, it, expect } from 'vitest';
import { parseDose, formatDose } from '../safety_check.js';

describe('parseDose', () => {
  // Requirement 5.4: null/undefined/empty/non-numeric returns null
  it('returns null for null', () => {
    expect(parseDose(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseDose(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDose('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseDose('abc')).toBeNull();
  });

  it('returns null for 0 (falsy but valid number)', () => {
    // 0 is a valid dose value — parseDose(0) should return 0
    expect(parseDose(0)).toBe(0);
  });

  // Requirement 5.5: reject negative values
  it('returns null for negative values', () => {
    expect(parseDose('-5', 'mg')).toBeNull();
  });

  it('returns null for negative string dose', () => {
    expect(parseDose('-100')).toBeNull();
  });

  // Requirement 5.3: extract numeric part from strings like "500mg", "1.5 g"
  it('parses "500mg" without unit param as mg', () => {
    expect(parseDose('500mg')).toBe(500);
  });

  it('parses "1.5" as 1.5 mg by default', () => {
    expect(parseDose('1.5')).toBe(1.5);
  });

  // Requirement 5.1: g → multiply by 1000
  it('converts g to mg (multiply by 1000)', () => {
    expect(parseDose('1.5', 'g')).toBe(1500);
  });

  it('converts g to mg for integer dose', () => {
    expect(parseDose('2', 'g')).toBe(2000);
  });

  // Requirement 5.2: mcg/μg → divide by 1000
  it('converts mcg to mg (divide by 1000)', () => {
    expect(parseDose('500', 'mcg')).toBe(0.5);
  });

  it('converts μg to mg (divide by 1000)', () => {
    expect(parseDose('250', 'μg')).toBe(0.25);
  });

  // Default to mg
  it('defaults to mg when unit is "mg"', () => {
    expect(parseDose('100', 'mg')).toBe(100);
  });

  it('defaults to mg when unit is not provided', () => {
    expect(parseDose('100')).toBe(100);
  });

  it('defaults to mg for unknown unit', () => {
    expect(parseDose('100', 'tablets')).toBe(100);
  });

  // Numeric input
  it('handles numeric input directly', () => {
    expect(parseDose(500, 'mg')).toBe(500);
  });

  it('handles numeric input with g unit', () => {
    expect(parseDose(1.5, 'g')).toBe(1500);
  });

  // Requirement 5.3: strings with embedded units
  it('parses "1.5 g" with unit param "g"', () => {
    expect(parseDose('1.5 g', 'g')).toBe(1500);
  });
});

describe('formatDose', () => {
  // Convert mg to g
  it('formats mg to g (divide by 1000)', () => {
    expect(formatDose(1500, 'g')).toBe('1.5');
  });

  // Convert mg to mcg
  it('formats mg to mcg (multiply by 1000)', () => {
    expect(formatDose(0.5, 'mcg')).toBe('500');
  });

  // Convert mg to μg
  it('formats mg to μg (multiply by 1000)', () => {
    expect(formatDose(0.25, 'μg')).toBe('250');
  });

  // Default to mg
  it('formats as mg by default', () => {
    expect(formatDose(100, 'mg')).toBe('100');
  });

  it('formats as mg when no unit provided', () => {
    expect(formatDose(100)).toBe('100');
  });

  it('returns string representation', () => {
    const result = formatDose(500, 'mg');
    expect(typeof result).toBe('string');
  });
});
