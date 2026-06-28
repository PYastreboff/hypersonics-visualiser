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

export function lbmDisplayModeLabel(mode: 'velocity' | 'pressure'): string {
  return mode === 'velocity' ? 'Velocity' : 'Pressure';
}

export function lbmRunModeLabel(mode: 'live' | 'prerender'): string {
  return mode === 'live' ? 'Live' : 'Pre-render';
}

/** gem.py treats inlet speed and velocity field values as m/s */
export function formatLbmSpeedMs(speed: number, decimals = 2): string {
  return `${speed.toFixed(decimals)} m/s`;
}

export function formatLbmLegendValue(
  displayMode: 'velocity' | 'pressure',
  value: number,
): string {
  if (displayMode === 'velocity') {
    return formatLbmSpeedMs(value, 3);
  }
  return value.toFixed(4);
}

export function lbmLegendUnitLabel(displayMode: 'velocity' | 'pressure'): string {
  if (displayMode === 'velocity') return 'm/s — low to high';
  return 'Lattice pressure — low (blue) to high (red)';
}

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
