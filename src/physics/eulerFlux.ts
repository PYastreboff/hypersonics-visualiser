import { GAMMA } from '@/physics/constants';
import type { EulerSolverScheme } from '@/types';

export type Conserved4 = [number, number, number, number];

const GAMMA_M1 = GAMMA - 1;

export const EULER_CFL = 0.35;

export const EULER_FLUX_SCHEME_LABELS: Record<EulerSolverScheme, string> = {
  rusanov: 'Rusanov (local Lax–Friedrichs)',
  hll: 'HLL',
  hllc: 'HLLC',
  roe: 'Roe (entropy fix)',
  ausmplus: 'AUSM+ (HLLC at subsonic faces)',
  kt: 'KT central-upwind',
};

function energyFromPrimitive(rho: number, un: number, ut: number, p: number): number {
  return p / GAMMA_M1 + 0.5 * rho * (un * un + ut * ut);
}

function conservedFromPrimitive(
  rho: number,
  un: number,
  ut: number,
  p: number,
): Conserved4 {
  return [rho, rho * un, rho * ut, energyFromPrimitive(rho, un, ut, p)];
}

function soundSpeed(rho: number, p: number): number {
  return Math.sqrt(GAMMA * p / Math.max(rho, 1e-6));
}

function signedEps(denom: number): number {
  if (Math.abs(denom) >= 1e-6) return denom;
  return denom >= 0 ? 1e-6 : -1e-6;
}

function entropyFix(lambda: number, a: number): number {
  const eps = 0.1 * a;
  const absL = Math.abs(lambda);
  if (absL >= 2 * eps) return absL;
  return (lambda * lambda) / (4 * eps) + eps;
}

function hllFlux(
  fL: Conserved4,
  fR: Conserved4,
  uL: Conserved4,
  uR: Conserved4,
  sL: number,
  sR: number,
): Conserved4 {
  if (sL >= 0) return fL;
  if (sR <= 0) return fR;
  const inv = 1 / signedEps(sR - sL);
  return [
    (sR * fL[0] - sL * fR[0] + sL * sR * (uR[0] - uL[0])) * inv,
    (sR * fL[1] - sL * fR[1] + sL * sR * (uR[1] - uL[1])) * inv,
    (sR * fL[2] - sL * fR[2] + sL * sR * (uR[2] - uL[2])) * inv,
    (sR * fL[3] - sL * fR[3] + sL * sR * (uR[3] - uL[3])) * inv,
  ];
}

export function fluxX(r: number, ux: number, vy: number, pr: number): Conserved4 {
  const e = energyFromPrimitive(r, ux, vy, pr);
  return [r * ux, r * ux * ux + pr, r * ux * vy, (e + pr) * ux];
}

export function fluxY(r: number, ux: number, vy: number, pr: number): Conserved4 {
  const e = energyFromPrimitive(r, ux, vy, pr);
  return [r * vy, r * ux * vy, r * vy * vy + pr, (e + pr) * vy];
}

export function rusanovX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
  waveSpeed: number,
): Conserved4 {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const uL4 = conservedFromPrimitive(rL, uL, vL, pL);
  const uR4 = conservedFromPrimitive(rR, uR, vR, pR);
  const halfS = 0.5 * waveSpeed;
  return [
    0.5 * (fL[0] + fR[0]) - halfS * (uR4[0] - uL4[0]),
    0.5 * (fL[1] + fR[1]) - halfS * (uR4[1] - uL4[1]),
    0.5 * (fL[2] + fR[2]) - halfS * (uR4[2] - uL4[2]),
    0.5 * (fL[3] + fR[3]) - halfS * (uR4[3] - uL4[3]),
  ];
}

export function rusanovY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
  waveSpeed: number,
): Conserved4 {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const uB4 = conservedFromPrimitive(rB, uB, vB, pB);
  const uT4 = conservedFromPrimitive(rT, uT, vT, pT);
  const halfS = 0.5 * waveSpeed;
  return [
    0.5 * (fB[0] + fT[0]) - halfS * (uT4[0] - uB4[0]),
    0.5 * (fB[1] + fT[1]) - halfS * (uT4[1] - uB4[1]),
    0.5 * (fB[2] + fT[2]) - halfS * (uT4[2] - uB4[2]),
    0.5 * (fB[3] + fT[3]) - halfS * (uT4[3] - uB4[3]),
  ];
}

export function hllX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved4 {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const uL4 = conservedFromPrimitive(rL, uL, vL, pL);
  const uR4 = conservedFromPrimitive(rR, uR, vR, pR);
  const aL = soundSpeed(rL, pL);
  const aR = soundSpeed(rR, pR);
  const sL = Math.min(uL - aL, uR - aR);
  const sR = Math.max(uL + aL, uR + aR);
  return hllFlux(fL, fR, uL4, uR4, sL, sR);
}

export function hllY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved4 {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const uB4 = conservedFromPrimitive(rB, uB, vB, pB);
  const uT4 = conservedFromPrimitive(rT, uT, vT, pT);
  const aB = soundSpeed(rB, pB);
  const aT = soundSpeed(rT, pT);
  const sL = Math.min(vB - aB, vT - aT);
  const sR = Math.max(vB + aB, vT + aT);
  return hllFlux(fB, fT, uB4, uT4, sL, sR);
}

export function hllcX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved4 {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const eL = energyFromPrimitive(rL, uL, vL, pL);
  const eR = energyFromPrimitive(rR, uR, vR, pR);
  const aL = soundSpeed(rL, pL);
  const aR = soundSpeed(rR, pR);
  const sL = Math.min(uL - aL, uR - aR);
  const sR = Math.max(uL + aL, uR + aR);

  if (sL >= 0) return fL;
  if (sR <= 0) return fR;

  const denom = signedEps(rL * (sL - uL) - rR * (sR - uR));
  const sStar = (pR - pL + rL * uL * (sL - uL) - rR * uR * (sR - uR)) / denom;

  if (sStar >= 0) {
    const rhoStar = (rL * (sL - uL)) / signedEps(sL - sStar);
    const pStar = pL + rL * (sL - uL) * (sStar - uL);
    const eStar = ((sL - uL) * eL - pL * uL + pStar * sStar) / signedEps(sL - sStar);
    const uStar: Conserved4 = [rhoStar, rhoStar * sStar, rhoStar * vL, eStar];
    const uL4: Conserved4 = [rL, rL * uL, rL * vL, eL];
    return [
      fL[0] + sL * (uStar[0] - uL4[0]),
      fL[1] + sL * (uStar[1] - uL4[1]),
      fL[2] + sL * (uStar[2] - uL4[2]),
      fL[3] + sL * (uStar[3] - uL4[3]),
    ];
  }

  const rhoStar = (rR * (sR - uR)) / signedEps(sR - sStar);
  const pStar = pR + rR * (sR - uR) * (sStar - uR);
  const eStar = ((sR - uR) * eR - pR * uR + pStar * sStar) / signedEps(sR - sStar);
  const uStar: Conserved4 = [rhoStar, rhoStar * sStar, rhoStar * vR, eStar];
  const uR4: Conserved4 = [rR, rR * uR, rR * vR, eR];
  return [
    fR[0] + sR * (uStar[0] - uR4[0]),
    fR[1] + sR * (uStar[1] - uR4[1]),
    fR[2] + sR * (uStar[2] - uR4[2]),
    fR[3] + sR * (uStar[3] - uR4[3]),
  ];
}

export function hllcY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved4 {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const eB = energyFromPrimitive(rB, uB, vB, pB);
  const eT = energyFromPrimitive(rT, uT, vT, pT);
  const aB = soundSpeed(rB, pB);
  const aT = soundSpeed(rT, pT);
  const sL = Math.min(vB - aB, vT - aT);
  const sR = Math.max(vB + aB, vT + aT);

  if (sL >= 0) return fB;
  if (sR <= 0) return fT;

  const denom = signedEps(rB * (sL - vB) - rT * (sR - vT));
  const sStar = (pT - pB + rB * vB * (sL - vB) - rT * vT * (sR - vT)) / denom;

  if (sStar >= 0) {
    const rhoStar = (rB * (sL - vB)) / signedEps(sL - sStar);
    const pStar = pB + rB * (sL - vB) * (sStar - vB);
    const eStar = ((sL - vB) * eB - pB * vB + pStar * sStar) / signedEps(sL - sStar);
    const uStar: Conserved4 = [rhoStar, rhoStar * uB, rhoStar * sStar, eStar];
    const uB4: Conserved4 = [rB, rB * uB, rB * vB, eB];
    return [
      fB[0] + sL * (uStar[0] - uB4[0]),
      fB[1] + sL * (uStar[1] - uB4[1]),
      fB[2] + sL * (uStar[2] - uB4[2]),
      fB[3] + sL * (uStar[3] - uB4[3]),
    ];
  }

  const rhoStar = (rT * (sR - vT)) / signedEps(sR - sStar);
  const pStar = pT + rT * (sR - vT) * (sStar - vT);
  const eStar = ((sR - vT) * eT - pT * vT + pStar * sStar) / signedEps(sR - sStar);
  const uStar: Conserved4 = [rhoStar, rhoStar * uT, rhoStar * sStar, eStar];
  const uT4: Conserved4 = [rT, rT * uT, rT * vT, eT];
  return [
    fT[0] + sR * (uStar[0] - uT4[0]),
    fT[1] + sR * (uStar[1] - uT4[1]),
    fT[2] + sR * (uStar[2] - uT4[2]),
    fT[3] + sR * (uStar[3] - uT4[3]),
  ];
}

function roeDissipationX(
  u: number,
  v: number,
  h: number,
  a: number,
  rL: number,
  rR: number,
  du: number,
  dv: number,
  dp: number,
): Conserved4 {
  const rhoHat = Math.max(Math.sqrt(rL * rR), 1e-6);
  const dr = rR - rL;
  const a2 = Math.max(a * a, 1e-12);
  const alpha1 = (dp - rhoHat * a * du) / (2 * a2);
  const alpha2 = dr - dp / a2;
  const alpha3 = dv;
  const alpha4 = (dp + rhoHat * a * du) / (2 * a2);
  const l1 = entropyFix(u - a, a);
  const l2 = entropyFix(u, a);
  const l4 = entropyFix(u + a, a);
  const kinetic = 0.5 * (u * u + v * v);
  const half = 0.5;
  return [
    half * (l1 * alpha1 + l2 * alpha2 + l4 * alpha4),
    half * (l1 * alpha1 * (u - a) + l2 * alpha2 * u + l4 * alpha4 * (u + a)),
    half * (l1 * alpha1 * v + l2 * (alpha2 * v + alpha3) + l4 * alpha4 * v),
    half * (l1 * alpha1 * (h - u * a) + l2 * (alpha2 * kinetic + alpha3 * v) + l4 * alpha4 * (h + u * a)),
  ];
}

function roeDissipationY(
  v: number,
  u: number,
  h: number,
  a: number,
  rB: number,
  rT: number,
  dv: number,
  du: number,
  dp: number,
): Conserved4 {
  const rhoHat = Math.max(Math.sqrt(rB * rT), 1e-6);
  const dr = rT - rB;
  const a2 = Math.max(a * a, 1e-12);
  const alpha1 = (dp - rhoHat * a * dv) / (2 * a2);
  const alpha2 = dr - dp / a2;
  const alpha3 = du;
  const alpha4 = (dp + rhoHat * a * dv) / (2 * a2);
  const l1 = entropyFix(v - a, a);
  const l2 = entropyFix(v, a);
  const l4 = entropyFix(v + a, a);
  const kinetic = 0.5 * (u * u + v * v);
  const half = 0.5;
  return [
    half * (l1 * alpha1 + l2 * alpha2 + l4 * alpha4),
    half * (l1 * alpha1 * u + l2 * (alpha2 * u + alpha3) + l4 * alpha4 * u),
    half * (l1 * alpha1 * (v - a) + l2 * alpha2 * v + l4 * alpha4 * (v + a)),
    half * (l1 * alpha1 * (h - v * a) + l2 * (alpha2 * kinetic + alpha3 * u) + l4 * alpha4 * (h + v * a)),
  ];
}

function roeX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved4 {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const sqrtRL = Math.sqrt(rL);
  const sqrtRR = Math.sqrt(rR);
  const inv = 1 / (sqrtRL + sqrtRR);
  const u = (sqrtRL * uR + sqrtRR * uL) * inv;
  const v = (sqrtRL * vR + sqrtRR * vL) * inv;
  const hL = (energyFromPrimitive(rL, uL, vL, pL) + pL) / rL;
  const hR = (energyFromPrimitive(rR, uR, vR, pR) + pR) / rR;
  const h = (sqrtRL * hR + sqrtRR * hL) * inv;
  const a = Math.sqrt(Math.max(GAMMA_M1 * (h - 0.5 * (u * u + v * v)), 1e-12));
  const diss = roeDissipationX(u, v, h, a, rL, rR, uR - uL, vR - vL, pR - pL);
  return [
    0.5 * (fL[0] + fR[0]) - diss[0],
    0.5 * (fL[1] + fR[1]) - diss[1],
    0.5 * (fL[2] + fR[2]) - diss[2],
    0.5 * (fL[3] + fR[3]) - diss[3],
  ];
}

function roeY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved4 {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const sqrtRB = Math.sqrt(rB);
  const sqrtRT = Math.sqrt(rT);
  const inv = 1 / (sqrtRB + sqrtRT);
  const v = (sqrtRB * vT + sqrtRT * vB) * inv;
  const u = (sqrtRB * uT + sqrtRT * uB) * inv;
  const hB = (energyFromPrimitive(rB, uB, vB, pB) + pB) / rB;
  const hT = (energyFromPrimitive(rT, uT, vT, pT) + pT) / rT;
  const h = (sqrtRB * hT + sqrtRT * hB) * inv;
  const a = Math.sqrt(Math.max(GAMMA_M1 * (h - 0.5 * (u * u + v * v)), 1e-12));
  const diss = roeDissipationY(v, u, h, a, rB, rT, vT - vB, uT - uB, pT - pB);
  return [
    0.5 * (fB[0] + fT[0]) - diss[0],
    0.5 * (fB[1] + fT[1]) - diss[1],
    0.5 * (fB[2] + fT[2]) - diss[2],
    0.5 * (fB[3] + fT[3]) - diss[3],
  ];
}

function splitMach(M: number): { plus: number; minus: number } {
  if (Math.abs(M) >= 1) {
    return { plus: 0.5 * (M + Math.abs(M)), minus: 0.5 * (M - Math.abs(M)) };
  }
  return { plus: 0.25 * (M + 1) ** 2, minus: 0.25 * (M - 1) ** 2 };
}

function splitPressure(M: number, p: number): { plus: number; minus: number } {
  if (Math.abs(M) >= 1) {
    return { plus: 0.5 * p * (1 + Math.sign(M)), minus: 0.5 * p * (1 - Math.sign(M)) };
  }
  return {
    plus: 0.25 * p * (M + 1) ** 2 * (2 - M),
    minus: 0.25 * p * (M - 1) ** 2 * (2 + M),
  };
}

function ausmplusX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved4 {
  const aL = soundSpeed(rL, pL);
  const aR = soundSpeed(rR, pR);
  const a12 = 0.5 * (aL + aR);
  const invA = 1 / Math.max(a12, 1e-6);
  const maL = uL * invA;
  const maR = uR * invA;
  const maxMa = Math.max(Math.abs(maL), Math.abs(maR));
  if (maxMa < 1) {
    return hllcX(rL, uL, vL, pL, rR, uR, vR, pR);
  }

  const mpL = splitMach(maL).plus;
  const mmR = splitMach(maR).minus;
  const p12 = splitPressure(maL, pL).plus + splitPressure(maR, pR).minus;
  const hL = (energyFromPrimitive(rL, uL, vL, pL) + pL) / rL;
  const hR = (energyFromPrimitive(rR, uR, vR, pR) + pR) / rR;
  const phiL: Conserved4 = [rL, rL * uL, rL * vL, rL * hL];
  const phiR: Conserved4 = [rR, rR * uR, rR * vR, rR * hR];
  return [
    a12 * (mpL * phiL[0] + mmR * phiR[0]),
    a12 * (mpL * phiL[1] + mmR * phiR[1]) + p12,
    a12 * (mpL * phiL[2] + mmR * phiR[2]),
    a12 * (mpL * phiL[3] + mmR * phiR[3]),
  ];
}

function ausmplusY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved4 {
  const aB = soundSpeed(rB, pB);
  const aT = soundSpeed(rT, pT);
  const a12 = 0.5 * (aB + aT);
  const invA = 1 / Math.max(a12, 1e-6);
  const maB = vB * invA;
  const maT = vT * invA;
  const maxMa = Math.max(Math.abs(maB), Math.abs(maT));
  if (maxMa < 1) {
    return hllcY(rB, uB, vB, pB, rT, uT, vT, pT);
  }

  const mpB = splitMach(maB).plus;
  const mmT = splitMach(maT).minus;
  const p12 = splitPressure(maB, pB).plus + splitPressure(maT, pT).minus;
  const hB = (energyFromPrimitive(rB, uB, vB, pB) + pB) / rB;
  const hT = (energyFromPrimitive(rT, uT, vT, pT) + pT) / rT;
  const phiB: Conserved4 = [rB, rB * uB, rB * vB, rB * hB];
  const phiT: Conserved4 = [rT, rT * uT, rT * vT, rT * hT];
  return [
    a12 * (mpB * phiB[0] + mmT * phiT[0]),
    a12 * (mpB * phiB[1] + mmT * phiT[1]),
    a12 * (mpB * phiB[2] + mmT * phiT[2]) + p12,
    a12 * (mpB * phiB[3] + mmT * phiT[3]),
  ];
}

function ktX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved4 {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const uL4 = conservedFromPrimitive(rL, uL, vL, pL);
  const uR4 = conservedFromPrimitive(rR, uR, vR, pR);
  const aL = soundSpeed(rL, pL);
  const aR = soundSpeed(rR, pR);
  const aPlus = Math.max(uR + aR, uL + aL, 0);
  const aMinus = Math.min(uR - aR, uL - aL, 0);
  const inv = 1 / signedEps(aPlus - aMinus);
  return [
    (aPlus * fL[0] - aMinus * fR[0] + aPlus * aMinus * (uR4[0] - uL4[0])) * inv,
    (aPlus * fL[1] - aMinus * fR[1] + aPlus * aMinus * (uR4[1] - uL4[1])) * inv,
    (aPlus * fL[2] - aMinus * fR[2] + aPlus * aMinus * (uR4[2] - uL4[2])) * inv,
    (aPlus * fL[3] - aMinus * fR[3] + aPlus * aMinus * (uR4[3] - uL4[3])) * inv,
  ];
}

function ktY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved4 {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const uB4 = conservedFromPrimitive(rB, uB, vB, pB);
  const uT4 = conservedFromPrimitive(rT, uT, vT, pT);
  const aB = soundSpeed(rB, pB);
  const aT = soundSpeed(rT, pT);
  const aPlus = Math.max(vT + aT, vB + aB, 0);
  const aMinus = Math.min(vT - aT, vB - aB, 0);
  const inv = 1 / signedEps(aPlus - aMinus);
  return [
    (aPlus * fB[0] - aMinus * fT[0] + aPlus * aMinus * (uT4[0] - uB4[0])) * inv,
    (aPlus * fB[1] - aMinus * fT[1] + aPlus * aMinus * (uT4[1] - uB4[1])) * inv,
    (aPlus * fB[2] - aMinus * fT[2] + aPlus * aMinus * (uT4[2] - uB4[2])) * inv,
    (aPlus * fB[3] - aMinus * fT[3] + aPlus * aMinus * (uT4[3] - uB4[3])) * inv,
  ];
}

export function interfaceFluxX(
  scheme: EulerSolverScheme,
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
  waveSpeed = Math.max(Math.abs(uL), Math.abs(uR)),
): Conserved4 {
  switch (scheme) {
    case 'hll':
      return hllX(rL, uL, vL, pL, rR, uR, vR, pR);
    case 'hllc':
      return hllcX(rL, uL, vL, pL, rR, uR, vR, pR);
    case 'roe':
      return roeX(rL, uL, vL, pL, rR, uR, vR, pR);
    case 'ausmplus':
      return ausmplusX(rL, uL, vL, pL, rR, uR, vR, pR);
    case 'kt':
      return ktX(rL, uL, vL, pL, rR, uR, vR, pR);
    case 'rusanov':
    default:
      return rusanovX(rL, uL, vL, pL, rR, uR, vR, pR, waveSpeed);
  }
}

export function interfaceFluxY(
  scheme: EulerSolverScheme,
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
  waveSpeed = Math.max(Math.abs(vB), Math.abs(vT)),
): Conserved4 {
  switch (scheme) {
    case 'hll':
      return hllY(rB, uB, vB, pB, rT, uT, vT, pT);
    case 'hllc':
      return hllcY(rB, uB, vB, pB, rT, uT, vT, pT);
    case 'roe':
      return roeY(rB, uB, vB, pB, rT, uT, vT, pT);
    case 'ausmplus':
      return ausmplusY(rB, uB, vB, pB, rT, uT, vT, pT);
    case 'kt':
      return ktY(rB, uB, vB, pB, rT, uT, vT, pT);
    case 'rusanov':
    default:
      return rusanovY(rB, uB, vB, pB, rT, uT, vT, pT, waveSpeed);
  }
}

export function eulerSoundSpeed(rho: number, p: number): number {
  return soundSpeed(rho, p);
}
