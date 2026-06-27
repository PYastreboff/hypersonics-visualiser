import { GAMMA } from './constants';

export function obliqueShockAngle(wedgeAngleRad: number, mach: number): number | null {
  if (mach <= 1) return null;
  const theta = Math.abs(wedgeAngleRad);
  const maxTheta = maxWedgeAngle(mach);
  if (theta > maxTheta + 1e-6) return null;

  let betaLow = Math.asin(1 / mach) + 1e-6;
  let betaHigh = Math.PI / 2 - 1e-6;

  for (let i = 0; i < 60; i++) {
    const betaMid = (betaLow + betaHigh) / 2;
    const thetaMid = thetaFromBetaMach(betaMid, mach);
    if (thetaMid > theta) betaHigh = betaMid;
    else betaLow = betaMid;
  }

  return (betaLow + betaHigh) / 2;
}

export function thetaFromBetaMach(beta: number, mach: number): number {
  const m1sq = mach * mach;
  const sinB = Math.sin(beta);
  const num = 2 / Math.tan(beta) * (m1sq * sinB * sinB - 1) / (m1sq * (GAMMA + Math.cos(2 * beta)) + 2);
  return Math.atan(num);
}

export function maxWedgeAngle(mach: number): number {
  if (mach <= 1) return 0;
  let maxT = 0;
  const betaMin = Math.asin(1 / mach);
  for (let i = 0; i < 200; i++) {
    const beta = betaMin + (i / 199) * (Math.PI / 2 - betaMin);
    maxT = Math.max(maxT, thetaFromBetaMach(beta, mach));
  }
  return maxT;
}

export function prandtlMeyerAngle(mach: number): number {
  if (mach <= 1) return 0;
  const gp1 = GAMMA + 1;
  const gm1 = GAMMA - 1;
  const m2 = mach * mach;
  const term =
    Math.sqrt(gp1 / gm1) * Math.atan(Math.sqrt(gm1 / gp1 * (m2 - 1))) - Math.atan(Math.sqrt(m2 - 1));
  return term;
}

export function machFromPrandtlMeyer(nu: number): number {
  let mLow = 1.001;
  let mHigh = 50;
  for (let i = 0; i < 50; i++) {
    const mMid = (mLow + mHigh) / 2;
    if (prandtlMeyerAngle(mMid) < nu) mLow = mMid;
    else mHigh = mMid;
  }
  return (mLow + mHigh) / 2;
}

export function bowShockStandoff(radius: number, mach: number): number {
  const m = Math.max(mach, 1.01);
  return radius * (0.143 * Math.exp(1.75 / (m - 1)));
}

export function bowShockDetachmentDistance(radius: number, mach: number): number {
  return bowShockStandoff(radius, mach) * 1.5;
}
