import { eulerTunnelSizeM } from '@/physics/eulerTunnelSolver';
import { eulerFreestreamPressure } from '@/physics/lbmConfig';
import { densityAtAltitude, speedOfSound, temperatureAtAltitude } from '@/physics/atmosphere';
import type { EulerTunnelResult } from '@/physics/eulerTunnelSolver';

export interface TunnelDragResult {
  /** Drag coefficient Cd = −Fx / (q∞ · Lref). */
  cd: number;
  /** Streamwise force per unit span (N/m or lattice units). */
  fxPerSpan: number;
  /** Reference length (m), obstacle chord in the flow direction. */
  referenceLengthM: number;
  /** Freestream dynamic pressure used for scaling. */
  q0: number;
}

/** Below this Mach, use solver pressures only. */
const NEWTONIAN_MACH_MIN = 2;
/** Modified Newtonian Cp,max for γ = 1.4 in the hypersonic limit. */
const NEWTONIAN_CP_MAX = 2;

/**
 * Wall pressure on an impinging face. At high Mach the cell-centred Euler field
 * under-resolves stagnation, so we floor windward pressure with modified Newtonian.
 */
function wallPressureGauge(
  pSolver: number,
  p0: number,
  q0: number,
  mach: number,
  impinging: boolean,
  sinSqTheta: number,
): number {
  const pGauge = pSolver - p0;
  if (!impinging || mach < NEWTONIAN_MACH_MIN || sinSqTheta <= 0) {
    return pGauge;
  }
  const pNewtonGauge = NEWTONIAN_CP_MAX * sinSqTheta * q0;
  return Math.max(pGauge, pNewtonGauge);
}

function integratePressureDrag(
  pressure: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  p0: number,
  q0: number,
  dy: number,
  mach: number,
): { fx: number; xMin: number; xMax: number; hasSolid: boolean } {
  let fx = 0;
  let xMin = nx;
  let xMax = -1;
  let hasSolid = false;

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const id = x * ny + y;
      if (obstacle[id]) {
        hasSolid = true;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        continue;
      }

      if (x < nx - 1 && obstacle[(x + 1) * ny + y]) {
        // Fluid upstream of solid — windward face (outward normal −x).
        const pGauge = wallPressureGauge(pressure[id], p0, q0, mach, true, 1);
        fx += pGauge * (-1) * dy;
      }
      if (x > 0 && obstacle[(x - 1) * ny + y]) {
        // Fluid downstream of solid — leeward face (outward normal +x).
        const pGauge = wallPressureGauge(pressure[id], p0, q0, mach, false, 1);
        fx += pGauge * (+1) * dy;
      }
    }
  }

  return { fx, xMin, xMax, hasSolid };
}

/**
 * Integrate gauge pressure on fluid cells adjacent to the obstacle.
 * Flow is +x; drag opposes motion so positive Cd means retarding force.
 */
export function computeTunnelDragFromPressure(
  pressure: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  p0: number,
  q0: number,
  lengthM: number,
  heightM: number,
  mach = 0,
): TunnelDragResult | null {
  if (q0 <= 0 || obstacle.length !== nx * ny) return null;

  const dx = lengthM / nx;
  const dy = heightM / ny;
  const { fx, xMin, xMax, hasSolid } = integratePressureDrag(
    pressure,
    obstacle,
    nx,
    ny,
    p0,
    q0,
    dy,
    mach,
  );

  if (!hasSolid || xMax < xMin) return null;

  const referenceLengthM = Math.max((xMax - xMin + 1) * dx, dx);
  const cd = -fx / (q0 * referenceLengthM);

  return { cd, fxPerSpan: fx, referenceLengthM, q0 };
}

export function computeEulerTunnelDrag(
  pressure: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  p0: number,
  q0: number,
  mach = 0,
): TunnelDragResult | null {
  const { lengthM, heightM } = eulerTunnelSizeM(nx, ny);
  return computeTunnelDragFromPressure(pressure, obstacle, nx, ny, p0, q0, lengthM, heightM, mach);
}

export function computeLbmTunnelDrag(
  pressure: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  windSpeed: number,
  fluidDensity: number,
): TunnelDragResult | null {
  const { lengthM, heightM } = eulerTunnelSizeM(nx, ny);
  const p0 = fluidDensity / 3;
  const q0 = 0.5 * fluidDensity * windSpeed * windSpeed;
  return computeTunnelDragFromPressure(
    pressure,
    obstacle,
    nx,
    ny,
    p0,
    q0,
    lengthM,
    heightM,
  );
}

export function formatDragCoefficient(cd: number): string {
  if (!Number.isFinite(cd)) return '—';
  if (Math.abs(cd) < 0.00005) return '0.000';
  return cd.toFixed(3);
}

export function freestreamDynamicPressure(mach: number, altitude: number): number {
  const temp = temperatureAtAltitude(altitude);
  const u0 = mach * speedOfSound(temp);
  const rho0 = densityAtAltitude(altitude);
  return 0.5 * rho0 * u0 * u0;
}

export function computeDragFromEulerResult(
  result: EulerTunnelResult,
  obstacle: Uint8Array,
): TunnelDragResult | null {
  const p0 = eulerFreestreamPressure(result.mach, result.altitude);
  const q0 = freestreamDynamicPressure(result.mach, result.altitude);
  return computeEulerTunnelDrag(
    result.pressure,
    obstacle,
    result.nx,
    result.ny,
    p0,
    q0,
    result.mach,
  );
}
