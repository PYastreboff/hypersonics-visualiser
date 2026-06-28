import type { LbmDisplayMode, LbmPhysicsMode } from '@/types';
import { eulerFreestreamPressure, eulerFreestreamSpeed } from '@/physics/lbmConfig';

/** Matplotlib-style jet colormap (t in [0, 1]). */
export function jetColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v; g = t; b = p; break;
    case 1:
      r = q; g = v; b = p; break;
    case 2:
      r = p; g = v; b = t; break;
    case 3:
      r = p; g = q; b = v; break;
    case 4:
      r = t; g = p; b = v; break;
    default:
      r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Full-spectrum rainbow (t=0 violet/blue → t=1 red). */
export function rainbowColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const hue = (1 - x) * 0.78;
  return hsvToRgb(hue, 1, 1);
}

/** Diverging cool–warm map for pressure (low → high). */
export function coolwarmColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) {
    const u = x * 2;
    return [
      Math.round(59 + (221 - 59) * u),
      Math.round(76 + (221 - 76) * u),
      Math.round(192 + (221 - 192) * u),
    ];
  }
  const u = (x - 0.5) * 2;
  return [
    Math.round(221 + (180 - 221) * u),
    Math.round(221 + (4 - 221) * u),
    Math.round(221 + (38 - 221) * u),
  ];
}

export function tunnelMetricColor(_displayMode: LbmDisplayMode, t: number): [number, number, number] {
  return rainbowColor(t);
}

export function lbmMetricColor(
  displayMode: 'velocity' | 'pressure',
  t: number,
): [number, number, number] {
  return tunnelMetricColor(displayMode, t);
}

/** Solid obstacle fill on rainbow fluid fields. */
export function lbmObstacleColor(
  _displayMode: LbmDisplayMode,
  highlighted: boolean,
  _physicsMode: LbmPhysicsMode = 'lbm',
): [number, number, number] {
  const g = highlighted ? 224 : 191;
  return [g, g, g];
}

export function fluidFieldMetricRange(
  metric: Float32Array,
  obstacle: Uint8Array,
): { vmin: number; vmax: number } | null {
  let vmin = Infinity;
  let vmax = -Infinity;
  let count = 0;

  for (let i = 0; i < metric.length; i++) {
    if (obstacle[i]) continue;
    const v = metric[i];
    if (!Number.isFinite(v)) continue;
    count++;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }

  if (count === 0 || !Number.isFinite(vmin)) return null;
  if (vmax <= vmin) return { vmin, vmax: vmin + 1e-6 };

  const span = vmax - vmin;
  const pad = Math.max(span * 0.02, 1e-9);
  return { vmin: vmin - pad, vmax: vmax + pad };
}

export function resolveTunnelMetricRange(
  physicsMode: LbmPhysicsMode,
  displayMode: LbmDisplayMode,
  windSpeed: number,
  fluidDensity: number,
  eulerMach: number,
  eulerAltitude: number,
  metric?: Float32Array,
  obstacle?: Uint8Array,
): { vmin: number; vmax: number } {
  if (physicsMode === 'euler' && metric && obstacle) {
    const adaptive = fluidFieldMetricRange(metric, obstacle);
    if (adaptive) return adaptive;
  }
  return tunnelMetricRange(
    physicsMode,
    displayMode,
    windSpeed,
    fluidDensity,
    eulerMach,
    eulerAltitude,
  );
}

export function tunnelMetricRange(
  physicsMode: LbmPhysicsMode,
  displayMode: LbmDisplayMode,
  windSpeed: number,
  fluidDensity = 1,
  eulerMach = 0.3,
  eulerAltitude = 0,
): { vmin: number; vmax: number } {
  if (physicsMode === 'euler') {
    const u0 = eulerFreestreamSpeed(eulerMach, eulerAltitude);
    const p0 = eulerFreestreamPressure(eulerMach, eulerAltitude);
    if (displayMode === 'velocity') {
      return { vmin: 0, vmax: Math.max(u0 * 1.8, 10) };
    }
    if (displayMode === 'mach') {
      return { vmin: 0, vmax: Math.max(eulerMach * 1.25, 0.5) };
    }
    const halfSpan = Math.max(p0 * 0.08 * Math.max(eulerMach, 0.1), 500);
    return { vmin: p0 - halfSpan, vmax: p0 + halfSpan };
  }

  if (displayMode === 'velocity') {
    return { vmin: 0, vmax: Math.max(windSpeed * 1.8, 0.01) };
  }
  if (displayMode === 'mach') {
    return { vmin: 0, vmax: 1 };
  }
  const center = fluidDensity / 3;
  const halfSpan = Math.max(windSpeed * 0.085, 0.001);
  return { vmin: center - halfSpan, vmax: center + halfSpan };
}

export function metricRange(
  displayMode: 'velocity' | 'pressure',
  windSpeed: number,
  fluidDensity = 1,
): { vmin: number; vmax: number } {
  return tunnelMetricRange('lbm', displayMode, windSpeed, fluidDensity);
}
