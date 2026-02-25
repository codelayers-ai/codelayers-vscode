import { describe, it, expect } from 'vitest';
import { getBlastRadiusColor, getBlastRadiusLabel, BLAST_RADIUS_COLORS } from '../lib/colors';

describe('BLAST_RADIUS_COLORS', () => {
  it('has 5 color entries (0-4)', () => {
    expect(Object.keys(BLAST_RADIUS_COLORS).length).toBe(5);
  });

  it('all values are hex color strings', () => {
    for (const color of Object.values(BLAST_RADIUS_COLORS)) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('getBlastRadiusColor', () => {
  it('returns red for distance 0', () => {
    expect(getBlastRadiusColor(0)).toBe('#FF3B30');
  });

  it('returns orange for distance 1', () => {
    expect(getBlastRadiusColor(1)).toBe('#FF9500');
  });

  it('returns yellow for distance 2', () => {
    expect(getBlastRadiusColor(2)).toBe('#FFCC00');
  });

  it('returns green for distance 3', () => {
    expect(getBlastRadiusColor(3)).toBe('#10B981');
  });

  it('returns teal for distance 4', () => {
    expect(getBlastRadiusColor(4)).toBe('#5AC8FA');
  });

  it('returns teal for distance > 4 (capped)', () => {
    expect(getBlastRadiusColor(5)).toBe('#5AC8FA');
    expect(getBlastRadiusColor(10)).toBe('#5AC8FA');
  });
});

describe('getBlastRadiusLabel', () => {
  it('returns "Changed" for distance 0', () => {
    expect(getBlastRadiusLabel(0)).toBe('Changed');
  });

  it('returns "1 hop" for distance 1', () => {
    expect(getBlastRadiusLabel(1)).toBe('1 hop');
  });

  it('returns "2" for distance 2', () => {
    expect(getBlastRadiusLabel(2)).toBe('2');
  });

  it('returns "3" for distance 3', () => {
    expect(getBlastRadiusLabel(3)).toBe('3');
  });

  it('returns "4+" for distance 4 and above', () => {
    expect(getBlastRadiusLabel(4)).toBe('4+');
    expect(getBlastRadiusLabel(5)).toBe('4+');
    expect(getBlastRadiusLabel(99)).toBe('4+');
  });
});
