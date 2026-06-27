import { GAMMA, R_AIR } from '@/physics/constants';
import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';

export interface BodyMask {
  kind: string;
  position: [number, number, number];
  scale: [number, number, number];
  params: Record<string, number | undefined>;
}

export interface SolverConfig {
  mach: number;
  altitude: number;
  gridNx: number;
  gridNy: number;
  bodies: BodyMask[];
}

export interface SolverResult {
  density: Float32Array;
  pressure: Float32Array;
  mach: Float32Array;
  temperature: Float32Array;
  gridNx: number;
  gridNy: number;
}

function isSolid(x: number, y: number, bodies: BodyMask[]): boolean {
  for (const body of bodies) {
    const lx = x - body.position[0];
    const ly = y - body.position[1];
    const r = (body.params.radius ?? 0.5) * Math.max(body.scale[1], body.scale[2]);
    const len = (body.params.length ?? 2) * body.scale[0];

    if (body.kind === 'sphere' || body.kind === 'custom') {
      if (lx * lx + ly * ly < r * r) return true;
    } else if (body.kind === 'cylinder') {
      if (Math.abs(lx) < len / 2 && ly * ly < r * r) return true;
    } else if (body.kind === 'wedge') {
      const h = (body.params.wedgeAngle ?? 10) * 0.02 * body.scale[1];
      const slope = h / len;
      if (Math.abs(lx) < len / 2 && Math.abs(ly) < slope * Math.abs(lx) + 0.05) return true;
    } else {
      const coneR = r * (1 - (lx + len / 2) / len);
      if (lx > -len / 2 && lx < len / 2 && Math.abs(ly) < Math.max(coneR, 0)) return true;
    }
  }
  return false;
}

export function runEuler2D(
  config: SolverConfig,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): SolverResult {
  const { mach, altitude, gridNx, gridNy, bodies } = config;
  const temp = temperatureAtAltitude(altitude);
  const rho0 = densityAtAltitude(altitude);
  const a0 = speedOfSound(temp);
  const u0 = mach * a0;
  const p0 = rho0 * a0 * a0 / GAMMA;

  const xMin = -6,
    xMax = 6,
    yMin = -2,
    yMax = 2;
  const dx = (xMax - xMin) / gridNx;
  const dy = (yMax - yMin) / gridNy;

  const n = gridNx * gridNy;
  const rho = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const p = new Float32Array(n);
  const solid = new Uint8Array(n);

  for (let j = 0; j < gridNy; j++) {
    for (let i = 0; i < gridNx; i++) {
      const idx = j * gridNx + i;
      const x = xMin + (i + 0.5) * dx;
      const y = yMin + (j + 0.5) * dy;
      solid[idx] = isSolid(x, y, bodies) ? 1 : 0;
      rho[idx] = rho0;
      u[idx] = u0;
      v[idx] = 0;
      p[idx] = p0;
    }
  }

  const steps = 400;
  const cfl = 0.4;

  for (let step = 0; step < steps; step++) {
    if (cancelled()) throw new Error('cancelled');
    if (step % 20 === 0) onProgress(step / steps);

    const rhoNew = new Float32Array(n);
    const uNew = new Float32Array(n);
    const vNew = new Float32Array(n);
    const pNew = new Float32Array(n);

    for (let j = 1; j < gridNy - 1; j++) {
      for (let i = 1; i < gridNx - 1; i++) {
        const idx = j * gridNx + i;
        if (solid[idx]) {
          rhoNew[idx] = rho0;
          uNew[idx] = 0;
          vNew[idx] = 0;
          pNew[idx] = p0;
          continue;
        }

        const r = rho[idx];
        const ux = u[idx];
        const vy = v[idx];
        const pr = p[idx];
        const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);

        const rL = rho[idx - 1],
          rR = rho[idx + 1];
        const uL = u[idx - 1],
          uR = u[idx + 1];
        const vL = v[idx - 1],
          vR = v[idx + 1];
        const pL = p[idx - 1],
          pR = p[idx + 1];

        const rB = rho[idx - gridNx],
          rT = rho[idx + gridNx];
        const uB = u[idx - gridNx],
          uT = u[idx + gridNx];
        const vB = v[idx - gridNx],
          vT = v[idx + gridNx];
        const pB = p[idx - gridNx],
          pT = p[idx + gridNx];

        const fxR = fluxX(rR, uR, vR, pR);
        const fxL = fluxX(rL, uL, vL, pL);
        const fyT = fluxY(rT, uT, vT, pT);
        const fyB = fluxY(rB, uB, vB, pB);

        const lambda = Math.max(
          Math.abs(ux) + a0,
          Math.abs(uL) + a0,
          Math.abs(uR) + a0,
          Math.abs(vy) + a0,
          Math.abs(vB) + a0,
          Math.abs(vT) + a0,
        );
        const dt = (cfl * Math.min(dx, dy)) / Math.max(lambda, 1);

        const dRho = -(fxR[0] - fxL[0]) / dx - (fyT[0] - fyB[0]) / dy;
        const dRhoU = -(fxR[1] - fxL[1]) / dx - (fyT[1] - fyB[1]) / dy;
        const dRhoV = -(fxR[2] - fxL[2]) / dx - (fyT[2] - fyB[2]) / dy;
        const dE = -(fxR[3] - fxL[3]) / dx - (fyT[3] - fyB[3]) / dy;

        rhoNew[idx] = Math.max(1e-6, r + dt * dRho);
        const rhoU = r * ux + dt * dRhoU;
        const rhoV = r * vy + dt * dRhoV;
        const EN = E + dt * dE;
        uNew[idx] = rhoU / rhoNew[idx];
        vNew[idx] = rhoV / rhoNew[idx];
        pNew[idx] = Math.max(1e3, (GAMMA - 1) * (EN - 0.5 * rhoNew[idx] * (uNew[idx] ** 2 + vNew[idx] ** 2)));
      }
    }

    for (let j = 0; j < gridNy; j++) {
      const jIn = Math.min(gridNy - 2, Math.max(1, j));
      rhoNew[j * gridNx] = rho0;
      uNew[j * gridNx] = u0;
      vNew[j * gridNx] = 0;
      pNew[j * gridNx] = p0;
      const outIdx = j * gridNx + gridNx - 1;
      rhoNew[outIdx] = rhoNew[jIn * gridNx + gridNx - 2];
      uNew[outIdx] = uNew[jIn * gridNx + gridNx - 2];
      vNew[outIdx] = vNew[jIn * gridNx + gridNx - 2];
      pNew[outIdx] = pNew[jIn * gridNx + gridNx - 2];
    }

    for (let i = 0; i < gridNx; i++) {
      rhoNew[i] = rho0;
      uNew[i] = u0;
      vNew[i] = 0;
      pNew[i] = p0;
      const top = (gridNy - 1) * gridNx + i;
      rhoNew[top] = rhoNew[gridNx + i];
      uNew[top] = uNew[gridNx + i];
      vNew[top] = vNew[gridNx + i];
      pNew[top] = pNew[gridNx + i];
    }

    rho.set(rhoNew);
    u.set(uNew);
    v.set(vNew);
    p.set(pNew);
  }

  onProgress(1);

  const machField = new Float32Array(n);
  const tempField = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const speed = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
    const a = Math.sqrt(GAMMA * p[i] / Math.max(rho[i], 1e-6));
    machField[i] = speed / a;
    tempField[i] = p[i] / (rho[i] * R_AIR);
  }

  return {
    density: rho,
    pressure: p,
    mach: machField,
    temperature: tempField,
    gridNx,
    gridNy,
  };
}

function fluxX(r: number, ux: number, vy: number, pr: number): [number, number, number, number] {
  const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);
  return [r * ux, r * ux * ux + pr, r * ux * vy, (E + pr) * ux];
}

function fluxY(r: number, ux: number, vy: number, pr: number): [number, number, number, number] {
  const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);
  return [r * vy, r * ux * vy, r * vy * vy + pr, (E + pr) * vy];
}
