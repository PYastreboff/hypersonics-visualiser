import { GAMMA, R_AIR } from '@/physics/constants';
import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';
import type { LbmDisplayMode, EulerSolverScheme, EulerSpatialOrder, EulerWallMode } from '@/types';
import { computeEulerTunnelDrag } from '@/physics/tunnelDrag';
import {
  EULER_CFL,
  eulerSoundSpeed,
  interfaceFluxX,
  interfaceFluxY,
} from '@/physics/eulerFlux';
import { facePrimitivesX, facePrimitivesY } from '@/physics/eulerReconstruction';

export interface EulerTunnelConfig {
  nx: number;
  ny: number;
  obstacle: Uint8Array;
  mach: number;
  altitude: number;
  steps?: number;
  /** Relative L∞ velocity change threshold for early stop (default 1e-4). */
  convergenceTolerance?: number;
  /** Live tunnel: keep stepping; skip convergence and max-step limits. */
  continuous?: boolean;
  /** Numerical interface flux scheme. */
  scheme?: EulerSolverScheme;
  /** Spatial reconstruction order (MUSCL is CPU-only). */
  spatialOrder?: EulerSpatialOrder;
  /** Tunnel top/bottom boundary mode. */
  wallMode?: EulerWallMode;
}

export interface EulerTunnelResult {
  nx: number;
  ny: number;
  mach: number;
  altitude: number;
  velocity: Float32Array;
  machField: Float32Array;
  pressure: Float32Array;
  temperature: Float32Array;
}


type ScalarField = Float32Array;

/** Max relative change in velocity (L∞) between two states, fluid cells only. */
export function fluidVelocityMaxDelta(
  uA: ScalarField,
  vA: ScalarField,
  uB: ScalarField,
  vB: ScalarField,
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

/** Ideal-gas static temperature (K) from derived Euler output fields. */
export function eulerTemperatureField(
  velocity: Float32Array,
  machField: Float32Array,
  obstacle: Uint8Array,
  altitude: number,
): Float32Array {
  const n = velocity.length;
  const out = new Float32Array(n);
  const tFreestream = temperatureAtAltitude(altitude);
  const eps = 1e-6;

  for (let i = 0; i < n; i++) {
    if (obstacle[i]) {
      out[i] = tFreestream;
      continue;
    }
    const ma = machField[i];
    const speed = velocity[i];
    if (ma > eps && speed > eps) {
      out[i] = (speed * speed) / (ma * ma * GAMMA * R_AIR);
    } else {
      out[i] = tFreestream;
    }
  }

  return out;
}

function idx(x: number, y: number, ny: number): number {
  return x * ny + y;
}

export function defaultEulerMaxSteps(nx: number, ny: number): number {
  return Math.min(4000, Math.max(1000, Math.round((nx * ny) / 20)));
}

/** Physical tunnel length (m); flow enters at x = 0 and exits at x = length. */
export const EULER_TUNNEL_LENGTH_M = 3;

export function eulerTunnelSizeM(nx: number, ny: number): { lengthM: number; heightM: number } {
  const lengthM = EULER_TUNNEL_LENGTH_M;
  return { lengthM, heightM: lengthM * (ny / nx) };
}

/** Incremental 2D compressible Euler solver for live convergence stepping. */
export class EulerTunnelSimulator {
  readonly nx: number;
  readonly ny: number;
  mach: number;
  altitude: number;
  readonly maxSteps: number;
  readonly velocity: Float32Array;
  readonly machField: Float32Array;
  readonly pressure: Float32Array;
  readonly temperature: Float32Array;

  stepIndex = 0;
  converged = false;
  simTimeS = 0;

  private readonly n: number;
  private rho0: number;
  private u0: number;
  private p0: number;
  private tFreestream: number;
  private readonly invDx: number;
  private readonly invDy: number;
  private readonly cellSize: number;
  private readonly tolerance: number;
  private readonly minSteps: number;
  private readonly continuous: boolean;
  private readonly checkInterval = 8;
  private readonly stableChecksRequired = 3;
  private readonly cfl = EULER_CFL;
  private readonly scheme: EulerSolverScheme;
  private readonly spatialOrder: EulerSpatialOrder;
  private readonly useMuscl: boolean;
  private readonly wallMode: EulerWallMode;
  private readonly solid: Uint8Array;
  private readonly aScratch: Float32Array;

  private rhoA: Float32Array;
  private uA: Float32Array;
  private vA: Float32Array;
  private pA: Float32Array;
  private rhoB: Float32Array;
  private uB: Float32Array;
  private vB: Float32Array;
  private pB: Float32Array;
  private stableChecks = 0;

  constructor(config: EulerTunnelConfig) {
    const { nx, ny, obstacle, mach, altitude } = config;
    this.nx = nx;
    this.ny = ny;
    this.mach = mach;
    this.altitude = altitude;
    this.n = nx * ny;

    const temp = temperatureAtAltitude(altitude);
    this.rho0 = densityAtAltitude(altitude);
    const a0 = speedOfSound(temp);
    this.u0 = mach * a0;
    this.p0 = (this.rho0 * a0 * a0) / GAMMA;
    this.tFreestream = temperatureAtAltitude(altitude);

    const lx = EULER_TUNNEL_LENGTH_M;
    const ly = lx * (ny / nx);
    const dx = lx / nx;
    const dy = ly / ny;
    this.invDx = 1 / dx;
    this.invDy = 1 / dy;
    this.cellSize = Math.min(dx, dy);

    this.continuous = config.continuous ?? false;
    this.scheme = config.scheme ?? 'rusanov';
    this.spatialOrder = config.spatialOrder ?? 'first';
    this.useMuscl = this.spatialOrder === 'muscl';
    this.wallMode = config.wallMode ?? 'reflective';
    this.maxSteps = config.steps ?? defaultEulerMaxSteps(nx, ny);
    this.tolerance = config.convergenceTolerance ?? 1e-4;
    this.minSteps = Math.min(300, Math.max(100, Math.floor(this.maxSteps * 0.08)));

    this.rhoA = new Float32Array(this.n);
    this.uA = new Float32Array(this.n);
    this.vA = new Float32Array(this.n);
    this.pA = new Float32Array(this.n);
    this.rhoB = new Float32Array(this.n);
    this.uB = new Float32Array(this.n);
    this.vB = new Float32Array(this.n);
    this.pB = new Float32Array(this.n);
    this.aScratch = new Float32Array(this.n);
    this.solid = new Uint8Array(this.n);
    this.velocity = new Float32Array(this.n);
    this.machField = new Float32Array(this.n);
    this.pressure = new Float32Array(this.n);
    this.temperature = new Float32Array(this.n);

    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        const id = idx(x, y, ny);
        this.solid[id] = obstacle[id];
        if (this.solid[id]) {
          this.rhoA[id] = this.rho0;
          this.uA[id] = 0;
          this.vA[id] = 0;
          this.pA[id] = this.p0;
          continue;
        }
        this.rhoA[id] = this.rho0;
        this.uA[id] = this.u0;
        this.vA[id] = 0;
        this.pA[id] = this.p0;
      }
    }

    this.syncOutputFields();
  }

  get progress(): number {
    if (this.continuous) return 0;
    if (this.converged) return 1;
    return Math.min(1, this.stepIndex / this.maxSteps);
  }

  step(): void {
    if (!this.continuous && (this.converged || this.stepIndex >= this.maxSteps)) {
      this.converged = true;
      return;
    }

    const { nx, ny, n } = this;

    for (let i = 0; i < n; i++) {
      if (this.solid[i]) continue;
      this.aScratch[i] = eulerSoundSpeed(this.rhoA[i], this.pA[i]);
    }

    let maxLambda = 1;
    for (let x = 1; x < nx - 1; x++) {
      const xBase = x * ny;
      for (let y = 1; y < ny - 1; y++) {
        const id = xBase + y;
        if (this.solid[id]) continue;

        const idL = id - ny;
        const idR = id + ny;
        const idB = id - 1;
        const idT = id + 1;

        const ux = this.uA[id];
        const vy = this.vA[id];
        const aC = this.aScratch[id];
        let lambda = Math.max(Math.abs(ux) + aC, Math.abs(vy) + aC);

        lambda = Math.max(lambda, Math.abs(this.uA[idL]) + this.aScratch[idL]);
        lambda = Math.max(lambda, Math.abs(this.uA[idR]) + this.aScratch[idR]);
        lambda = Math.max(lambda, Math.abs(this.vA[idB]) + this.aScratch[idB]);
        lambda = Math.max(lambda, Math.abs(this.vA[idT]) + this.aScratch[idT]);

        if (lambda > maxLambda) maxLambda = lambda;
      }
    }
    const dt = (this.cfl * this.cellSize) / maxLambda;

    for (let x = 1; x < nx - 1; x++) {
      const xBase = x * ny;
      for (let y = 1; y < ny - 1; y++) {
        const id = xBase + y;
        if (this.solid[id]) {
          this.rhoB[id] = this.rho0;
          this.uB[id] = 0;
          this.vB[id] = 0;
          this.pB[id] = this.p0;
          continue;
        }

        const r = this.rhoA[id];
        const ux = this.uA[id];
        const vy = this.vA[id];
        const pr = this.pA[id];
        const E = pr / (GAMMA - 1) + 0.5 * r * (ux * ux + vy * vy);

        const idL = id - ny;
        const idR = id + ny;
        const idB = id - 1;
        const idT = id + 1;

        const uL = this.uA[idL];
        const uR = this.uA[idR];
        const vB_n = this.vA[idB];
        const vT = this.vA[idT];
        const aC = this.aScratch[id];
        const aL = this.aScratch[idL];
        const aR = this.aScratch[idR];
        const aB = this.aScratch[idB];
        const aT = this.aScratch[idT];

        let fxR: ReturnType<typeof interfaceFluxX>;
        let fxL: ReturnType<typeof interfaceFluxX>;
        let fyT: ReturnType<typeof interfaceFluxY>;
        let fyB: ReturnType<typeof interfaceFluxY>;

        if (this.useMuscl) {
          const [fxRightL, fxRightR] = facePrimitivesX(
            this.spatialOrder,
            this.rhoA,
            this.uA,
            this.vA,
            this.pA,
            this.solid,
            id,
            idR,
            this.ny,
          );
          const [fxLeftL, fxLeftR] = facePrimitivesX(
            this.spatialOrder,
            this.rhoA,
            this.uA,
            this.vA,
            this.pA,
            this.solid,
            idL,
            id,
            this.ny,
          );
          const [fyTopB, fyTopT] = facePrimitivesY(
            this.spatialOrder,
            this.rhoA,
            this.uA,
            this.vA,
            this.pA,
            this.solid,
            id,
            idT,
          );
          const [fyBotB, fyBotT] = facePrimitivesY(
            this.spatialOrder,
            this.rhoA,
            this.uA,
            this.vA,
            this.pA,
            this.solid,
            idB,
            id,
          );
          fxR = interfaceFluxX(
            this.scheme,
            fxRightL.rho,
            fxRightL.u,
            fxRightL.v,
            fxRightL.p,
            fxRightR.rho,
            fxRightR.u,
            fxRightR.v,
            fxRightR.p,
            Math.max(Math.abs(ux) + aC, Math.abs(uR) + aR),
          );
          fxL = interfaceFluxX(
            this.scheme,
            fxLeftL.rho,
            fxLeftL.u,
            fxLeftL.v,
            fxLeftL.p,
            fxLeftR.rho,
            fxLeftR.u,
            fxLeftR.v,
            fxLeftR.p,
            Math.max(Math.abs(uL) + aL, Math.abs(ux) + aC),
          );
          fyT = interfaceFluxY(
            this.scheme,
            fyTopB.rho,
            fyTopB.u,
            fyTopB.v,
            fyTopB.p,
            fyTopT.rho,
            fyTopT.u,
            fyTopT.v,
            fyTopT.p,
            Math.max(Math.abs(vy) + aC, Math.abs(vT) + aT),
          );
          fyB = interfaceFluxY(
            this.scheme,
            fyBotB.rho,
            fyBotB.u,
            fyBotB.v,
            fyBotB.p,
            fyBotT.rho,
            fyBotT.u,
            fyBotT.v,
            fyBotT.p,
            Math.max(Math.abs(vB_n) + aB, Math.abs(vy) + aC),
          );
        } else {
          const rhoL = this.rhoA[idL];
          const vL = this.vA[idL];
          const pL = this.pA[idL];
          const rhoR = this.rhoA[idR];
          const vR = this.vA[idR];
          const pR = this.pA[idR];
          const rhoB = this.rhoA[idB];
          const uB_n = this.uA[idB];
          const pB = this.pA[idB];
          const rhoT = this.rhoA[idT];
          const uT = this.uA[idT];
          const pT = this.pA[idT];
          fxR = interfaceFluxX(
            this.scheme,
            r,
            ux,
            vy,
            pr,
            rhoR,
            uR,
            vR,
            pR,
            Math.max(Math.abs(ux) + aC, Math.abs(uR) + aR),
          );
          fxL = interfaceFluxX(
            this.scheme,
            rhoL,
            uL,
            vL,
            pL,
            r,
            ux,
            vy,
            pr,
            Math.max(Math.abs(uL) + aL, Math.abs(ux) + aC),
          );
          fyT = interfaceFluxY(
            this.scheme,
            r,
            ux,
            vy,
            pr,
            rhoT,
            uT,
            vT,
            pT,
            Math.max(Math.abs(vy) + aC, Math.abs(vT) + aT),
          );
          fyB = interfaceFluxY(
            this.scheme,
            rhoB,
            uB_n,
            vB_n,
            pB,
            r,
            ux,
            vy,
            pr,
            Math.max(Math.abs(vB_n) + aB, Math.abs(vy) + aC),
          );
        }

        const dRho = -(fxR[0] - fxL[0]) * this.invDx - (fyT[0] - fyB[0]) * this.invDy;
        const dRhoU = -(fxR[1] - fxL[1]) * this.invDx - (fyT[1] - fyB[1]) * this.invDy;
        const dRhoV = -(fxR[2] - fxL[2]) * this.invDx - (fyT[2] - fyB[2]) * this.invDy;
        const dE = -(fxR[3] - fxL[3]) * this.invDx - (fyT[3] - fyB[3]) * this.invDy;

        this.rhoB[id] = Math.max(1e-6, r + dt * dRho);
        const rhoU = r * ux + dt * dRhoU;
        const rhoV = r * vy + dt * dRhoV;
        const EN = E + dt * dE;
        const rhoNew = this.rhoB[id];
        const uNew = rhoU / rhoNew;
        const vNew = rhoV / rhoNew;
        this.uB[id] = uNew;
        this.vB[id] = vNew;
        this.pB[id] = Math.max(
          1e3,
          (GAMMA - 1) * (EN - 0.5 * rhoNew * (uNew * uNew + vNew * vNew)),
        );
      }
    }

    this.applyBoundaryConditions(this.rhoB, this.uB, this.vB, this.pB);

    const step = this.stepIndex;
    if (
      !this.continuous &&
      step >= this.minSteps &&
      step % this.checkInterval === 0
    ) {
      const delta = fluidVelocityMaxDelta(this.uA, this.vA, this.uB, this.vB, this.solid, this.u0);
      if (delta < this.tolerance) {
        this.stableChecks += 1;
        if (this.stableChecks >= this.stableChecksRequired) {
          [this.rhoA, this.rhoB] = [this.rhoB, this.rhoA];
          [this.uA, this.uB] = [this.uB, this.uA];
          [this.vA, this.vB] = [this.vB, this.vA];
          [this.pA, this.pB] = [this.pB, this.pA];
          this.stepIndex += 1;
          this.simTimeS += dt;
          this.converged = true;
          this.syncOutputFields();
          return;
        }
      } else {
        this.stableChecks = 0;
      }
    }

    [this.rhoA, this.rhoB] = [this.rhoB, this.rhoA];
    [this.uA, this.uB] = [this.uB, this.uA];
    [this.vA, this.vB] = [this.vB, this.vA];
    [this.pA, this.pB] = [this.pB, this.pA];
    this.stepIndex += 1;
    this.simTimeS += dt;

    if (!this.continuous && this.stepIndex >= this.maxSteps) {
      this.converged = true;
    }

    if (!this.continuous) {
      this.syncOutputFields();
    }
  }

  steps(count: number): number {
    let ran = 0;
    for (let i = 0; i < count && (this.continuous || !this.converged); i++) {
      this.step();
      ran += 1;
    }
    return ran;
  }

  /** Patch obstacle mask in-place and resume iterating toward a new steady state. */
  updateObstacle(obstacle: Uint8Array): void {
    if (obstacle.length !== this.n) return;

    const wasSolid = new Uint8Array(this.solid);
    const newlyFluid = new Uint8Array(this.n);

    for (let id = 0; id < this.n; id++) {
      const isSolid = obstacle[id] !== 0;
      if (wasSolid[id] && !isSolid) newlyFluid[id] = 1;

      if (!wasSolid[id] && isSolid) {
        this.rhoA[id] = this.rho0;
        this.uA[id] = 0;
        this.vA[id] = 0;
        this.pA[id] = this.p0;
      }

      this.solid[id] = isSolid ? 1 : 0;
    }

    this.fillNewlyFluidCells(newlyFluid);
    this.resumeFromEdit();
  }

  /**
   * Seed opened cells from nearby fluid instead of uniform freestream.
   * Avoids a flat pressure/velocity block where an obstacle used to sit.
   */
  private fillNewlyFluidCells(newlyFluid: Uint8Array): void {
    const filled = new Uint8Array(this.n);

    for (let pass = 0; pass < this.nx + this.ny; pass++) {
      let filledAny = false;
      for (let id = 0; id < this.n; id++) {
        if (!newlyFluid[id] || filled[id]) continue;
        if (this.interpolateFluidFromNeighbors(id, newlyFluid, filled)) {
          filled[id] = 1;
          filledAny = true;
        }
      }
      if (!filledAny) break;
    }

    for (let id = 0; id < this.n; id++) {
      if (!newlyFluid[id] || filled[id]) continue;
      this.rhoA[id] = this.rho0;
      this.uA[id] = this.u0;
      this.vA[id] = 0;
      this.pA[id] = this.p0;
    }
  }

  private interpolateFluidFromNeighbors(
    id: number,
    newlyFluid: Uint8Array,
    filled: Uint8Array,
  ): boolean {
    const { nx, ny } = this;
    const x = Math.floor(id / ny);
    const y = id % ny;

    let count = 0;
    let rho = 0;
    let u = 0;
    let v = 0;
    let p = 0;

    const neighbors: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx_, ny_] of neighbors) {
      if (nx_ < 0 || nx_ >= nx || ny_ < 0 || ny_ >= ny) continue;
      const nid = idx(nx_, ny_, ny);
      if (this.solid[nid]) continue;
      if (newlyFluid[nid] && !filled[nid]) continue;

      rho += this.rhoA[nid];
      u += this.uA[nid];
      v += this.vA[nid];
      p += this.pA[nid];
      count += 1;
    }

    if (count === 0) return false;

    const inv = 1 / count;
    this.rhoA[id] = Math.max(1e-6, rho * inv);
    this.uA[id] = u * inv;
    this.vA[id] = v * inv;
    this.pA[id] = Math.max(1e3, p * inv);
    return true;
  }

  /** Update freestream Mach/altitude and inlet BC without cold-restarting the field. */
  updateFlowParams(mach: number, altitude: number): void {
    this.mach = mach;
    this.altitude = altitude;

    const temp = temperatureAtAltitude(altitude);
    this.rho0 = densityAtAltitude(altitude);
    const a0 = speedOfSound(temp);
    this.u0 = mach * a0;
    this.p0 = (this.rho0 * a0 * a0) / GAMMA;
    this.tFreestream = temp;

    for (let y = 0; y < this.ny; y++) {
      const id = idx(0, y, this.ny);
      if (this.solid[id]) continue;
      this.rhoA[id] = this.rho0;
      this.uA[id] = this.u0;
      this.vA[id] = 0;
      this.pA[id] = this.p0;
    }

    this.resumeFromEdit();
  }

  private resumeFromEdit(): void {
    this.converged = false;
    this.stableChecks = 0;
    this.syncOutputFields();
  }

  computeObstacleDrag(obstacle: Uint8Array) {
    const q0 = 0.5 * this.rho0 * this.u0 * this.u0;
    return computeEulerTunnelDrag(
      this.pressure,
      obstacle,
      this.nx,
      this.ny,
      this.p0,
      q0,
      this.mach,
    );
  }

  buildResult(): EulerTunnelResult {
    this.syncOutputFields();
    return {
      nx: this.nx,
      ny: this.ny,
      mach: this.mach,
      altitude: this.altitude,
      velocity: this.velocity,
      machField: this.machField,
      pressure: this.pressure,
      temperature: this.temperature,
    };
  }

  private applyBoundaryConditions(
    rho: ScalarField,
    u: ScalarField,
    v: ScalarField,
    p: ScalarField,
  ): void {
    const { nx, ny, rho0, u0, p0 } = this;
    for (let y = 0; y < ny; y++) {
      const inGhost = idx(nx - 2, y, ny);
      const outId = idx(nx - 1, y, ny);
      rho[idx(0, y, ny)] = rho0;
      u[idx(0, y, ny)] = u0;
      v[idx(0, y, ny)] = 0;
      p[idx(0, y, ny)] = p0;
      // Outlet: zero-gradient (simple transmissive-style outflow).
      rho[outId] = rho[inGhost];
      u[outId] = u[inGhost];
      v[outId] = v[inGhost];
      p[outId] = p[inGhost];
    }

    for (let x = 0; x < nx; x++) {
      const bot = idx(x, 0, ny);
      const top = idx(x, ny - 1, ny);
      const botIn = idx(x, 1, ny);
      const topIn = idx(x, ny - 2, ny);
      if (this.wallMode === 'open') {
        rho[bot] = rho[botIn];
        u[bot] = u[botIn];
        v[bot] = v[botIn];
        p[bot] = p[botIn];
        rho[top] = rho[topIn];
        u[top] = u[topIn];
        v[top] = v[topIn];
        p[top] = p[topIn];
      } else {
        rho[bot] = rho[botIn];
        u[bot] = u[botIn];
        v[bot] = -v[botIn];
        p[bot] = p[botIn];
        rho[top] = rho[topIn];
        u[top] = u[topIn];
        v[top] = -v[topIn];
        p[top] = p[topIn];
      }
    }
  }

  private syncOutputFields(): void {
    const { n, solid, p0, tFreestream } = this;
    for (let i = 0; i < n; i++) {
      if (solid[i]) {
        this.velocity[i] = 0;
        this.machField[i] = 0;
        this.pressure[i] = p0;
        this.temperature[i] = tFreestream;
        continue;
      }
      const speed = Math.sqrt(this.uA[i] * this.uA[i] + this.vA[i] * this.vA[i]);
      const a = eulerSoundSpeed(this.rhoA[i], this.pA[i]);
      this.velocity[i] = speed;
      this.machField[i] = speed / Math.max(a, 1e-6);
      this.pressure[i] = this.pA[i];
      this.temperature[i] = this.pA[i] / (Math.max(this.rhoA[i], 1e-6) * R_AIR);
    }
  }
}

/** 2D compressible Euler on the LBM tunnel grid (idx = x * ny + y). */
export function runEulerTunnel(
  config: EulerTunnelConfig,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): EulerTunnelResult {
  const sim = new EulerTunnelSimulator(config);

  while (!sim.converged && sim.stepIndex < sim.maxSteps) {
    if (cancelled()) throw new Error('cancelled');
    sim.step();
    if (sim.stepIndex % 25 === 0) onProgress(sim.progress);
  }

  onProgress(1);
  return sim.buildResult();
}

export function getEulerTunnelMetric(
  result: EulerTunnelResult,
  displayMode: LbmDisplayMode,
): Float32Array {
  if (displayMode === 'velocity') return result.velocity;
  if (displayMode === 'mach') return result.machField;
  if (displayMode === 'temperature') return result.temperature;
  return result.pressure;
}
