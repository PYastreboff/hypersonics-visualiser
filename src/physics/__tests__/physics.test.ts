import { describe, it, expect } from 'vitest';
import { detectRegime } from '../regimes';
import { normalShockPressureRatio, normalShockMachDownstream } from '../rankineHugoniot';
import { obliqueShockAngle, thetaFromBetaMach } from '../shockRelations';
import { temperatureAtAltitude, reynoldsNumber } from '../atmosphere';

describe('regimes', () => {
  it('detects subsonic', () => {
    expect(detectRegime(0.5)).toBe('subsonic');
  });
  it('detects transonic', () => {
    expect(detectRegime(1.0)).toBe('transonic');
  });
  it('detects supersonic', () => {
    expect(detectRegime(3)).toBe('supersonic');
  });
  it('detects hypersonic', () => {
    expect(detectRegime(6)).toBe('hypersonic');
  });
});

describe('Rankine-Hugoniot', () => {
  it('reduces Mach across normal shock', () => {
    const m2 = normalShockMachDownstream(2);
    expect(m2).toBeLessThan(1);
    expect(m2).toBeGreaterThan(0.4);
  });

  it('increases pressure across shock', () => {
    expect(normalShockPressureRatio(2)).toBeGreaterThan(1);
  });
});

describe('oblique shock', () => {
  it('returns shock angle for wedge at M=2', () => {
    const wedge = (10 * Math.PI) / 180;
    const beta = obliqueShockAngle(wedge, 2);
    expect(beta).not.toBeNull();
    if (beta) {
      expect(beta).toBeGreaterThan(Math.asin(1 / 2));
      const theta = thetaFromBetaMach(beta, 2);
      expect(theta).toBeCloseTo(wedge, 1);
    }
  });
});

describe('atmosphere', () => {
  it('decreases temperature with altitude', () => {
    expect(temperatureAtAltitude(5000)).toBeLessThan(temperatureAtAltitude(0));
  });

  it('computes Reynolds number', () => {
    const re = reynoldsNumber(2, 10000, 1);
    expect(re).toBeGreaterThan(1e5);
  });
});
