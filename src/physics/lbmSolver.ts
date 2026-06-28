const VEL: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
const BOUNCE_BACK = [0, 3, 4, 1, 2, 7, 8, 5, 6];

function roll2d(
  src: Float64Array,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
): Float64Array {
  const out = new Float64Array(nx * ny);
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const sx = (x - dx + nx) % nx;
      const sy = (y - dy + ny) % ny;
      out[x * ny + y] = src[sx * ny + sy];
    }
  }
  return out;
}

export interface LbmConfig {
  nx: number;
  ny: number;
  windSpeed: number;
  tau?: number;
  rho0?: number;
}

export class LbmSolver {
  readonly nx: number;
  readonly ny: number;
  readonly windSpeed: number;
  readonly tau: number;
  readonly rho0: number;
  readonly obstacle: Uint8Array;
  readonly F: Float64Array[];

  constructor(config: LbmConfig, obstacle: Uint8Array) {
    this.nx = config.nx;
    this.ny = config.ny;
    this.windSpeed = config.windSpeed;
    this.tau = config.tau ?? 0.6;
    this.rho0 = config.rho0 ?? 1.0;
    this.obstacle = obstacle;
    this.F = Array.from({ length: 9 }, (_, i) => {
      const arr = new Float64Array(config.nx * config.ny);
      arr.fill(W[i] * this.rho0);
      return arr;
    });
  }

  updateObstacle(mask: Uint8Array): void {
    if (mask.length !== this.obstacle.length) return;
    this.obstacle.set(mask);
  }

  step(): void {
    const { nx, ny, obstacle, F, windSpeed, tau, rho0 } = this;
    const size = nx * ny;

    for (let i = 0; i < 9; i++) {
      F[i] = roll2d(F[i], nx, ny, VEL[i][0], VEL[i][1]);
    }

    for (let i = 0; i < 9; i++) {
      const bb = BOUNCE_BACK[i];
      for (let idx = 0; idx < size; idx++) {
        if (obstacle[idx]) F[i][idx] = F[bb][idx];
      }
    }

    const rho = new Float64Array(size);
    const ux = new Float64Array(size);
    const uy = new Float64Array(size);

    for (let idx = 0; idx < size; idx++) {
      let r = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < 9; i++) {
        const fi = F[i][idx];
        r += fi;
        mx += fi * VEL[i][0];
        my += fi * VEL[i][1];
      }
      rho[idx] = r;
      ux[idx] = mx / r;
      uy[idx] = my / r;
    }

    for (let y = 0; y < ny; y++) {
      const idx = y;
      ux[idx] = windSpeed;
      uy[idx] = 0;
      rho[idx] = rho0;
    }

    const invTau = 1 / tau;
    for (let i = 0; i < 9; i++) {
      const [vx, vy] = VEL[i];
      const wi = W[i];
      for (let idx = 0; idx < size; idx++) {
        const cu = vx * ux[idx] + vy * uy[idx];
        const u2 = ux[idx] * ux[idx] + uy[idx] * uy[idx];
        const feq = wi * rho[idx] * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * u2);
        F[i][idx] += -invTau * (F[i][idx] - feq);
      }
    }
  }

  getMacroscopic(): { ux: Float64Array; uy: Float64Array; rho: Float64Array } {
    const { F } = this;
    const size = this.nx * this.ny;
    const rho = new Float64Array(size);
    const ux = new Float64Array(size);
    const uy = new Float64Array(size);

    for (let idx = 0; idx < size; idx++) {
      let r = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < 9; i++) {
        const fi = F[i][idx];
        r += fi;
        mx += fi * VEL[i][0];
        my += fi * VEL[i][1];
      }
      rho[idx] = r;
      ux[idx] = mx / r;
      uy[idx] = my / r;
      if (this.obstacle[idx]) {
        ux[idx] = 0;
        uy[idx] = 0;
      }
    }

    return { ux, uy, rho };
  }

  getMetric(displayMode: 'velocity' | 'pressure'): Float32Array {
    const { ux, uy, rho } = this.getMacroscopic();
    const metric = new Float32Array(ux.length);
    if (displayMode === 'velocity') {
      for (let i = 0; i < metric.length; i++) {
        metric[i] = Math.sqrt(ux[i] * ux[i] + uy[i] * uy[i]);
      }
    } else {
      for (let i = 0; i < metric.length; i++) {
        metric[i] = rho[i] * (1 / 3);
      }
    }
    return metric;
  }
}
