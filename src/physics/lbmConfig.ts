import { GAMMA } from '@/physics/constants';
import {
  densityAtAltitude,
  speedOfSound,
  temperatureAtAltitude,
} from '@/physics/atmosphere';
import type { LbmDisplayMode } from '@/types';

export const LBM_FRAME_MS = 30;
export const LBM_DEFAULT_TUNNEL_NX = 300;
export const LBM_DEFAULT_TUNNEL_NY = 100;
export const LBM_MIN_TUNNEL_NX = 120;
export const LBM_MAX_TUNNEL_NX = 1800;
export const LBM_MIN_TUNNEL_NY = 40;
export const LBM_MAX_TUNNEL_NY = 600;
export const LBM_RENDER_STEP = 20;

export const LBM_RESOLUTION_SCALES = [0.5, 1, 2, 3, 4, 6] as const;

export type LbmResolutionScale = (typeof LBM_RESOLUTION_SCALES)[number];

export function clampTunnelNx(nx: number): number {
  return Math.min(LBM_MAX_TUNNEL_NX, Math.max(LBM_MIN_TUNNEL_NX, Math.round(nx)));
}

export function clampTunnelNy(ny: number): number {
  return Math.min(LBM_MAX_TUNNEL_NY, Math.max(LBM_MIN_TUNNEL_NY, Math.round(ny)));
}

export function lbmResolutionLabel(
  scale: number,
  tunnelNx = LBM_DEFAULT_TUNNEL_NX,
  tunnelNy = LBM_DEFAULT_TUNNEL_NY,
): string {
  const { nx, ny } = lbmGridSize(tunnelNx, tunnelNy, scale);
  const tier =
    scale <= 0.5
      ? 'Low'
      : scale <= 1
        ? 'Standard'
        : scale <= 2
          ? 'High'
          : scale <= 3
            ? 'Very high'
            : scale <= 4
              ? 'Ultra'
              : 'Extreme';
  return `${tier} — ${nx} × ${ny} cells`;
}

export function lbmDisplayModeLabel(mode: LbmDisplayMode): string {
  if (mode === 'mach') return 'Mach';
  if (mode === 'temperature') return 'Temperature';
  return mode === 'velocity' ? 'Velocity' : 'Pressure';
}

export function lbmPhysicsModeLabel(mode: 'lbm' | 'euler'): string {
  return mode === 'lbm' ? 'Low Speed (LBM)' : 'MACH (Euler)';
}

export function lbmRunModeLabel(mode: 'live' | 'prerender'): string {
  return mode === 'live' ? 'Live' : 'Pre-render';
}

export function eulerRunModeLabel(mode: 'live' | 'steady'): string {
  return mode === 'live' ? 'Live' : 'Steady solve';
}

/** Pseudo-time steps per animation frame for live Euler convergence. */
export function eulerLiveStepsPerFrame(nx: number, ny: number): number {
  const cells = nx * ny;
  return Math.max(8, Math.min(48, Math.round(cells / 900)));
}

export const EULER_FRAME_MS = 30;

/** Target wall-clock interval between live simulation frames (LBM and Euler). */
export const LIVE_FRAME_MS = LBM_FRAME_MS;

export function liveSimTimeMsFromFrames(frames: number): number {
  return frames * LIVE_FRAME_MS;
}

/** True when simulation time is keeping up with wall clock (≈ one frame behind). */
export function isLiveSimRealTime(simMs: number, wallMs: number): boolean {
  if (simMs < LIVE_FRAME_MS) return false;
  return wallMs - simMs <= LIVE_FRAME_MS * 2;
}

export function formatPhysicalSimTime(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 1e-9) return '0 µs';
  if (s < 1e-3) {
    const us = s * 1e6;
    return us < 10 ? `${us.toFixed(1)} µs` : `${Math.round(us)} µs`;
  }
  if (s < 1) {
    const ms = s * 1e3;
    if (ms < 10) return `${ms.toFixed(2)} ms`;
    if (ms < 100) return `${ms.toFixed(1)} ms`;
    return `${Math.round(ms)} ms`;
  }
  return `${s.toFixed(2)} s`;
}

export function formatEulerElapsedMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatLiveSimTime(simMs: number, realTime: boolean): string {
  const base = formatEulerElapsedMs(simMs);
  return realTime ? `${base} · real time` : base;
}

export const EULER_MIN_MACH = 0;
export const EULER_MAX_MACH = 12;

export function clampEulerMach(mach: number): number {
  return Math.min(EULER_MAX_MACH, Math.max(EULER_MIN_MACH, Number.isFinite(mach) ? mach : 0));
}

export function eulerFreestreamSpeed(mach: number, altitude: number): number {
  return mach * speedOfSound(temperatureAtAltitude(altitude));
}

export function eulerFreestreamPressure(_mach: number, altitude: number): number {
  const temp = temperatureAtAltitude(altitude);
  const rho0 = densityAtAltitude(altitude);
  const a0 = speedOfSound(temp);
  return rho0 * a0 * a0 / GAMMA;
}
export function formatLbmSpeedMs(speed: number, decimals = 2): string {
  return `${speed.toFixed(decimals)} m/s`;
}

export function formatLbmLegendValue(
  displayMode: LbmDisplayMode,
  value: number,
  physicsMode: 'lbm' | 'euler' = 'lbm',
): string {
  if (!Number.isFinite(value)) return '—';
  if (displayMode === 'velocity') {
    return formatLbmSpeedMs(value, 3);
  }
  if (displayMode === 'mach') {
    return value.toFixed(2);
  }
  if (displayMode === 'temperature') {
    return `${value.toFixed(0)} K`;
  }
  if (displayMode === 'pressure' && physicsMode === 'euler') {
    return `${(value / 1000).toFixed(1)} kPa`;
  }
  return value.toFixed(4);
}

export function lbmLegendUnitLabel(displayMode: LbmDisplayMode): string {
  if (displayMode === 'velocity') return 'm/s — low to high';
  if (displayMode === 'mach') return 'Mach — low to high';
  if (displayMode === 'temperature') return 'K — low to high';
  return 'Lattice pressure — low to high';
}

/** gem.py treats inlet speed and velocity field values as m/s */

/**
 * Lattice reference density ρ₀ (dimensionless), not SI kg/m³.
 * gem.py uses 1.0. Accuracy is best near 1; bounds below are a stability envelope
 * for this D2Q9 BGK scheme (τ = 0.6, u ≤ 0.15): distributions must stay positive.
 * There is no single theoretical maximum — only positivity of fᵢ and small Ma.
 */
export const LBM_DEFAULT_FLUID_DENSITY = 1;
/** Hard lower bound: ρ₀ must be > 0 (LBM cannot represent negative density). */
export const LBM_MIN_FLUID_DENSITY = 0.1;
/** Practical upper bound before feq can go negative at u = 0.15, τ = 0.6. */
export const LBM_MAX_FLUID_DENSITY = 2.5;
export const LBM_FLUID_DENSITY_STEP = 0.05;

export function clampLbmFluidDensity(density: number): number {
  const stepped = Math.round(density / LBM_FLUID_DENSITY_STEP) * LBM_FLUID_DENSITY_STEP;
  return Math.min(
    LBM_MAX_FLUID_DENSITY,
    Math.max(LBM_MIN_FLUID_DENSITY, Math.round(stepped * 100) / 100),
  );
}

export function formatLbmFluidDensity(density: number): string {
  return density.toFixed(2);
}

export function snapLbmResolutionScale(scale: number): LbmResolutionScale {
  return LBM_RESOLUTION_SCALES.reduce((best, v) =>
    Math.abs(v - scale) < Math.abs(best - scale) ? v : best,
  );
}

/** int(PLAYBACK_TIME_SECONDS * (1000 / 30)) in gem.py */
export function lbmTotalFrames(playbackSeconds: number): number {
  return Math.floor(playbackSeconds * (1000 / LBM_FRAME_MS));
}

/** round((frame_idx * 30) / 1000, 1) in gem.py */
export function lbmFrameToTime(frameIdx: number): number {
  return Math.round(((frameIdx * LBM_FRAME_MS) / 1000) * 10) / 10;
}

export function lbmGridSize(
  tunnelNx: number,
  tunnelNy: number,
  resolutionScale: number,
): { nx: number; ny: number; renderStep: number } {
  const nx = Math.max(60, Math.round(tunnelNx * resolutionScale));
  const ny = Math.max(20, Math.round(tunnelNy * resolutionScale));
  const renderStep = Math.max(1, Math.round(LBM_RENDER_STEP * resolutionScale));
  return { nx, ny, renderStep };
}
