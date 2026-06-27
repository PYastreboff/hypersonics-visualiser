import { GAMMA } from './constants';

export function normalShockMachDownstream(m1: number): number {
  const m1sq = m1 * m1;
  const num = 1 + 0.5 * (GAMMA - 1) * m1sq;
  const den = GAMMA * m1sq - 0.5 * (GAMMA - 1);
  return Math.sqrt(num / den);
}

export function normalShockPressureRatio(m1: number): number {
  const m1sq = m1 * m1;
  return 1 + (2 * GAMMA / (GAMMA + 1)) * (m1sq - 1);
}

export function normalShockDensityRatio(m1: number): number {
  const m1sq = m1 * m1;
  const num = (GAMMA + 1) * m1sq;
  const den = 2 + (GAMMA - 1) * m1sq;
  return num / den;
}

export function normalShockTemperatureRatio(m1: number): number {
  const pRatio = normalShockPressureRatio(m1);
  const rhoRatio = normalShockDensityRatio(m1);
  return pRatio / rhoRatio;
}

export function postShockState(
  m1: number,
  p1: number,
  rho1: number,
  t1: number,
): { m2: number; p2: number; rho2: number; t2: number } {
  const pRatio = normalShockPressureRatio(m1);
  const rhoRatio = normalShockDensityRatio(m1);
  const tRatio = normalShockTemperatureRatio(m1);
  return {
    m2: normalShockMachDownstream(m1),
    p2: p1 * pRatio,
    rho2: rho1 * rhoRatio,
    t2: t1 * tRatio,
  };
}
