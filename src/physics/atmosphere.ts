import {
  G,
  GAMMA,
  MU_SEA_LEVEL,
  P_SEA_LEVEL,
  R_AIR,
  T_SEA_LEVEL,
} from './constants';

const LAPSE_RATE = 0.0065;

export function temperatureAtAltitude(altitudeM: number): number {
  const h = Math.max(0, Math.min(altitudeM, 11000));
  return T_SEA_LEVEL - LAPSE_RATE * h;
}

export function pressureAtAltitude(altitudeM: number): number {
  const h = Math.max(0, Math.min(altitudeM, 11000));
  const T = temperatureAtAltitude(h);
  const exponent = (G * 0.0289644) / (R_AIR * LAPSE_RATE);
  return P_SEA_LEVEL * Math.pow(T / T_SEA_LEVEL, exponent);
}

export function densityAtAltitude(altitudeM: number): number {
  const T = temperatureAtAltitude(altitudeM);
  const P = pressureAtAltitude(altitudeM);
  return P / (R_AIR * T);
}

export function speedOfSound(tempK: number): number {
  return Math.sqrt(GAMMA * R_AIR * tempK);
}

export function dynamicViscosity(tempK: number): number {
  return MU_SEA_LEVEL * Math.pow(tempK / T_SEA_LEVEL, 0.76);
}

export function velocityFromMach(mach: number, tempK: number): number {
  return mach * speedOfSound(tempK);
}

export function reynoldsNumber(
  mach: number,
  altitudeM: number,
  lengthM: number,
  tempK?: number,
): number {
  const T = tempK ?? temperatureAtAltitude(altitudeM);
  const rho = densityAtAltitude(altitudeM);
  const V = velocityFromMach(mach, T);
  const mu = dynamicViscosity(T);
  return (rho * V * lengthM) / mu;
}

export function dynamicPressure(mach: number, altitudeM: number, tempK?: number): number {
  const T = tempK ?? temperatureAtAltitude(altitudeM);
  const rho = densityAtAltitude(altitudeM);
  const V = velocityFromMach(mach, T);
  return 0.5 * rho * V * V;
}

export function stagnationTemperature(freeStreamTemp: number, mach: number): number {
  return freeStreamTemp * (1 + 0.5 * (GAMMA - 1) * mach * mach);
}

export function adiabaticWallTemp(
  freeStreamTemp: number,
  mach: number,
  recovery: number,
): number {
  return freeStreamTemp * (1 + recovery * 0.5 * (GAMMA - 1) * mach * mach);
}
