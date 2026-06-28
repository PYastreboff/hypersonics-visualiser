import { GAMMA } from '@/physics/constants';
import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';

export interface EulerTunnelConfig {
  nx: number;
  ny: number;
  obstacle: Uint8Array;
  mach: number;
  altitude: number;
  steps?: number;
  /** Relative L∞ velocity change threshold for early stop (default 1e-4). */
  convergenceTolerance?: number;
}

export interface EulerTunnelResult {
  nx: number;
  ny: number;
  mach: number;
  altitude: number;
  velocity: Float32Array;
  machField: Float32Array;
  pressure: Float32Array;
}

type Conserved = [number, number, number, number];

/** Max relative change in velocity (L∞) between two states, fluid cells only. */
export function fluidVelocityMaxDelta(
  uA: Float64Array,
  vA: Float64Array,
  uB: Float64Array,
  vB: Float64Array,
  solid: Uint8Array,
  speedScale: number,
): number {
  const scale = Math.max(speedScale, 1e-6);
  let maxDelta = 0;
  for (let i = 0; i < uA.length; i++) {
    if (solid[i]) continue;
    maxDelta = Math.max(maxDelta, Math.abs(uB[i] - uA[i]), Math.abs(vB[i] - vA[i]));
  }
  return maxDelta / scale;
}

function defaultMaxSteps(nx: number, ny: number): number {
  return Math.min(4000, Math.max(1000, Math.round((nx * ny) / 20)));
}

function idx(x: number, y: number, ny: number): number {
  return x * ny + y;
}

function soundSpeed(rho: number, p: number): number {
  return Math.sqrt(GAMMA * p / Math.max(rho, 1e-6));
}

function fluxX(r: number, ux: number, vy: number, pr: number): Conserved {
  const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);
  return [r * ux, r * ux * ux + pr, r * ux * vy, (E + pr) * ux];
}

function fluxY(r: number, ux: number, vy: number, pr: number): Conserved {
  const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);
  return [r * vy, r * ux * vy, r * vy * vy + pr, (E + pr) * vy];
}

function rusanovX(
  rL: number,
  uL: number,
  vL: number,
  pL: number,
  rR: number,
  uR: number,
  vR: number,
  pR: number,
): Conserved {
  const fL = fluxX(rL, uL, vL, pL);
  const fR = fluxX(rR, uR, vR, pR);
  const aL = soundSpeed(rL, pL);
  const aR = soundSpeed(rR, pR);
  const s = Math.max(Math.abs(uL) + aL, Math.abs(uR) + aR);
  const uL_c: Conserved = [rL, rL * uL, rL * vL, pL / (GAMMA - 1) + 0.5 * rL * (uL * uL + vL * vL)];
  const uR_c: Conserved = [rR, rR * uR, rR * vR, pR / (GAMMA - 1) + 0.5 * rR * (uR * uR + vR * vR)];
  return [
    0.5 * (fL[0] + fR[0]) - 0.5 * s * (uR_c[0] - uL_c[0]),
    0.5 * (fL[1] + fR[1]) - 0.5 * s * (uR_c[1] - uL_c[1]),
    0.5 * (fL[2] + fR[2]) - 0.5 * s * (uR_c[2] - uL_c[2]),
    0.5 * (fL[3] + fR[3]) - 0.5 * s * (uR_c[3] - uL_c[3]),
  ];
}

function rusanovY(
  rB: number,
  uB: number,
  vB: number,
  pB: number,
  rT: number,
  uT: number,
  vT: number,
  pT: number,
): Conserved {
  const fB = fluxY(rB, uB, vB, pB);
  const fT = fluxY(rT, uT, vT, pT);
  const aB = soundSpeed(rB, pB);
  const aT = soundSpeed(rT, pT);
  const s = Math.max(Math.abs(vB) + aB, Math.abs(vT) + aT);
  const uB_c: Conserved = [rB, rB * uB, rB * vB, pB / (GAMMA - 1) + 0.5 * rB * (uB * uB + vB * vB)];
  const uT_c: Conserved = [rT, rT * uT, rT * vT, pT / (GAMMA - 1) + 0.5 * rT * (uT * uT + vT * vT)];
  return [
    0.5 * (fB[0] + fT[0]) - 0.5 * s * (uT_c[0] - uB_c[0]),
    0.5 * (fB[1] + fT[1]) - 0.5 * s * (uT_c[1] - uB_c[1]),
    0.5 * (fB[2] + fT[2]) - 0.5 * s * (uT_c[2] - uB_c[2]),
    0.5 * (fB[3] + fT[3]) - 0.5 * s * (uT_c[3] - uB_c[3]),
  ];
}

/** 2D compressible Euler on the LBM tunnel grid (idx = x * ny + y). */
export function runEulerTunnel(
  config: EulerTunnelConfig,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): EulerTunnelResult {
  const { nx, ny, obstacle, mach, altitude } = config;
  const temp = temperatureAtAltitude(altitude);
  const rho0 = densityAtAltitude(altitude);
  const a0 = speedOfSound(temp);
  const u0 = mach * a0;
  const p0 = rho0 * a0 * a0 / GAMMA;

  const Lx = 3.0;
  const Ly = Lx * (ny / nx);
  const dx = Lx / nx;
  const dy = Ly / ny;
  const n = nx * ny;

  let rhoA = new Float64Array(n);
  let uA = new Float64Array(n);
  let vA = new Float64Array(n);
  let pA = new Float64Array(n);
  let rhoB = new Float64Array(n);
  let uB = new Float64Array(n);
  let vB = new Float64Array(n);
  let pB = new Float64Array(n);
  const solid = new Uint8Array(n);

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const id = idx(x, y, ny);
      solid[id] = obstacle[id];
      if (solid[id]) {
        rhoA[id] = rho0;
        uA[id] = 0;
        vA[id] = 0;
        pA[id] = p0;
        continue;
      }
      rhoA[id] = rho0;
      uA[id] = u0;
      vA[id] = 0;
      pA[id] = p0;
    }
  }

  const maxSteps = config.steps ?? defaultMaxSteps(nx, ny);
  const tolerance = config.convergenceTolerance ?? 1e-4;
  const minSteps = Math.min(300, Math.max(100, Math.floor(maxSteps * 0.08)));
  const checkInterval = 8;
  const stableChecksRequired = 3;
  const cfl = 0.35;
  let stableChecks = 0;

  const applyBoundaryConditions = (
    rho: Float64Array,
    u: Float64Array,
    v: Float64Array,
    p: Float64Array,
  ) => {
    for (let y = 0; y < ny; y++) {
      const inGhost = idx(nx - 2, y, ny);
      const outId = idx(nx - 1, y, ny);
      rho[idx(0, y, ny)] = rho0;
      u[idx(0, y, ny)] = u0;
      v[idx(0, y, ny)] = 0;
      p[idx(0, y, ny)] = p0;
      rho[outId] = rho[inGhost];
      u[outId] = u[inGhost];
      v[outId] = v[inGhost];
      p[outId] = p[inGhost];
    }

    for (let x = 0; x < nx; x++) {
      const botIn = idx(x, 1, ny);
      const topIn = idx(x, ny - 2, ny);
      rho[idx(x, 0, ny)] = rho[botIn];
      u[idx(x, 0, ny)] = u[botIn];
      v[idx(x, 0, ny)] = -v[botIn];
      p[idx(x, 0, ny)] = p[botIn];
      const top = idx(x, ny - 1, ny);
      rho[top] = rho[topIn];
      u[top] = u[topIn];
      v[top] = -v[topIn];
      p[top] = p[topIn];
    }
  };

  for (let step = 0; step < maxSteps; step++) {
    if (cancelled()) throw new Error('cancelled');
    if (step % 25 === 0) onProgress(step / maxSteps);

    for (let x = 1; x < nx - 1; x++) {
      for (let y = 1; y < ny - 1; y++) {
        const id = idx(x, y, ny);
        if (solid[id]) {
          rhoB[id] = rho0;
          uB[id] = 0;
          vB[id] = 0;
          pB[id] = p0;
          continue;
        }

        const r = rhoA[id];
        const ux = uA[id];
        const vy = vA[id];
        const pr = pA[id];
        const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);

        const idL = idx(x - 1, y, ny);
        const idR = idx(x + 1, y, ny);
        const idB = idx(x, y - 1, ny);
        const idT = idx(x, y + 1, ny);

        const fxR = rusanovX(
          rhoA[id], uA[id], vA[id], pA[id],
          rhoA[idR], uA[idR], vA[idR], pA[idR],
        );
        const fxL = rusanovX(
          rhoA[idL], uA[idL], vA[idL], pA[idL],
          rhoA[id], uA[id], vA[id], pA[id],
        );
        const fyT = rusanovY(
          rhoA[id], uA[id], vA[id], pA[id],
          rhoA[idT], uA[idT], vA[idT], pA[idT],
        );
        const fyB = rusanovY(
          rhoA[idB], uA[idB], vA[idB], pA[idB],
          rhoA[id], uA[id], vA[id], pA[id],
        );

        const a = soundSpeed(r, pr);
        const lambda = Math.max(
          Math.abs(ux) + a,
          Math.abs(uA[idL]) + soundSpeed(rhoA[idL], pA[idL]),
          Math.abs(uA[idR]) + soundSpeed(rhoA[idR], pA[idR]),
          Math.abs(vy) + a,
          Math.abs(vA[idB]) + soundSpeed(rhoA[idB], pA[idB]),
          Math.abs(vA[idT]) + soundSpeed(rhoA[idT], pA[idT]),
        );
        const dt = (cfl * Math.min(dx, dy)) / Math.max(lambda, 1);

        const dRho = -(fxR[0] - fxL[0]) / dx - (fyT[0] - fyB[0]) / dy;
        const dRhoU = -(fxR[1] - fxL[1]) / dx - (fyT[1] - fyB[1]) / dy;
        const dRhoV = -(fxR[2] - fxL[2]) / dx - (fyT[2] - fyB[2]) / dy;
        const dE = -(fxR[3] - fxL[3]) / dx - (fyT[3] - fyB[3]) / dy;

        rhoB[id] = Math.max(1e-6, r + dt * dRho);
        const rhoU = r * ux + dt * dRhoU;
        const rhoV = r * vy + dt * dRhoV;
        const EN = E + dt * dE;
        uB[id] = rhoU / rhoB[id];
        vB[id] = rhoV / rhoB[id];
        pB[id] = Math.max(1e3, (GAMMA - 1) * (EN - 0.5 * rhoB[id] * (uB[id] ** 2 + vB[id] ** 2)));
      }
    }

    applyBoundaryConditions(rhoB, uB, vB, pB);

    if (step >= minSteps && step % checkInterval === 0) {
      const delta = fluidVelocityMaxDelta(uA, vA, uB, vB, solid, u0);
      if (delta < tolerance) {
        stableChecks += 1;
        if (stableChecks >= stableChecksRequired) {
          [rhoA, rhoB] = [rhoB, rhoA];
          [uA, uB] = [uB, uA];
          [vA, vB] = [vB, vA];
          [pA, pB] = [pB, pA];
          break;
        }
      } else {
        stableChecks = 0;
      }
    }

    [rhoA, rhoB] = [rhoB, rhoA];
    [uA, uB] = [uB, uA];
    [vA, vB] = [vB, vA];
    [pA, pB] = [pB, pA];
  }

  onProgress(1);

  const velocity = new Float32Array(n);
  const machField = new Float32Array(n);
  const pressure = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    if (solid[i]) {
      velocity[i] = 0;
      machField[i] = 0;
      pressure[i] = p0;
      continue;
    }
    const speed = Math.sqrt(uA[i] * uA[i] + vA[i] * vA[i]);
    const a = soundSpeed(rhoA[i], pA[i]);
    velocity[i] = speed;
    machField[i] = speed / Math.max(a, 1e-6);
    pressure[i] = pA[i];
  }

  return {
    nx,
    ny,
    mach,
    altitude,
    velocity,
    machField,
    pressure,
  };
}

export function getEulerTunnelMetric(
  result: EulerTunnelResult,
  displayMode: 'velocity' | 'pressure' | 'mach',
): Float32Array {
  if (displayMode === 'velocity') return result.velocity;
  if (displayMode === 'mach') return result.machField;
  return result.pressure;
}
