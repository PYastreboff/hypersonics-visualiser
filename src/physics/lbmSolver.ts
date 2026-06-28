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
  windSpeed: number;
  readonly tau: number;
  rho0: number;
  readonly obstacle: Uint8Array;
  readonly F: Float64Array[];
  private readonly displayUx: Float64Array;
  private readonly displayUy: Float64Array;
  private readonly displayRho: Float64Array;

  constructor(config: LbmConfig, obstacle: Uint8Array) {
    this.nx = config.nx;
    this.ny = config.ny;
    this.windSpeed = config.windSpeed;
    this.tau = config.tau ?? 0.6;
    this.rho0 = config.rho0 ?? 1.0;
    this.obstacle = obstacle;
    const size = config.nx * config.ny;
    this.displayUx = new Float64Array(size);
    this.displayUy = new Float64Array(size);
    this.displayRho = new Float64Array(size);
    this.F = Array.from({ length: 9 }, (_, i) => {
      const arr = new Float64Array(size);
      arr.fill(W[i] * this.rho0);
      return arr;
    });
    this.seedDisplayState();
  }

  private seedDisplayState(): void {
    const { windSpeed, rho0, obstacle, displayUx } = this;
    for (let idx = 0; idx < displayUx.length; idx++) {
      if (obstacle[idx]) {
        this.displayUx[idx] = 0;
        this.displayUy[idx] = 0;
        this.displayRho[idx] = rho0;
        continue;
      }
      this.displayUx[idx] = windSpeed;
      this.displayUy[idx] = 0;
      this.displayRho[idx] = rho0;
    }
  }

  updateObstacle(mask: Uint8Array): void {
    if (mask.length !== this.obstacle.length) return;
    this.obstacle.set(mask);
  }

  /** Change reference density in-place — scales distributions to preserve velocity. */
  updateFluidDensity(rho0: number): void {
    if (rho0 <= 0 || !Number.isFinite(rho0)) return;
    const ratio = rho0 / this.rho0;
    if (Math.abs(ratio - 1) < 1e-12) return;
    this.rho0 = rho0;
    for (let i = 0; i < 9; i++) {
      const fi = this.F[i];
      for (let idx = 0; idx < fi.length; idx++) {
        fi[idx] *= ratio;
      }
    }
    for (let idx = 0; idx < this.displayRho.length; idx++) {
      if (!this.obstacle[idx]) {
        this.displayRho[idx] = rho0;
      }
    }
  }

  updateWindSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.windSpeed = speed;
    for (let idx = 0; idx < this.displayUx.length; idx++) {
      if (!this.obstacle[idx]) {
        this.displayUx[idx] = speed;
      }
    }
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

    this.displayUx.set(ux);
    this.displayUy.set(uy);
    this.displayRho.set(rho);

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

    for (let idx = 0; idx < size; idx++) {
      if (obstacle[idx]) {
        this.displayUx[idx] = 0;
        this.displayUy[idx] = 0;
      }
    }
  }

  /** Post-collision state from distributions. */
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

  /** gem.py display snapshot — pre-collision macroscopic with inlet BC. */
  getDisplayMacroscopic(): { ux: Float64Array; uy: Float64Array; rho: Float64Array } {
    return {
      ux: this.displayUx,
      uy: this.displayUy,
      rho: this.displayRho,
    };
  }

  getMetric(displayMode: 'velocity' | 'pressure'): Float32Array {
    const { ux, uy, rho } = this.getDisplayMacroscopic();
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
