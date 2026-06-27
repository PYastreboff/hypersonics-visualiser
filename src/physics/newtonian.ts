import { GAMMA } from './constants';

export function newtonianCp(pressureAngleRad: number): number {
  const sinA = Math.sin(Math.abs(pressureAngleRad));
  return 2 * sinA * sinA;
}

export function modifiedNewtonianCp(
  pressureAngleRad: number,
  mach: number,
  cpMax?: number,
): number {
  const cpMaxVal = cpMax ?? 2 / (GAMMA * mach * mach) * ((GAMMA + 1) / 2 * mach * mach - 1);
  const sinA = Math.sin(Math.abs(pressureAngleRad));
  return cpMaxVal * sinA * sinA;
}

export function cpFromMachNormal(mach: number): number {
  if (mach <= 1) return 1;
  const m2 = mach * mach;
  return (2 / (GAMMA * m2)) * ((GAMMA + 1) / 2 * m2 - 1);
}

export function pressureCoefficient(p: number, pInf: number, qInf: number): number {
  if (qInf <= 0) return 0;
  return (p - pInf) / qInf;
}
