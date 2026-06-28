/** Matplotlib-style jet colormap (t in [0, 1]). */
export function jetColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
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

export function lbmMetricColor(
  displayMode: 'velocity' | 'pressure',
  t: number,
): [number, number, number] {
  return displayMode === 'pressure' ? coolwarmColor(t) : jetColor(t);
}

export function metricRange(
  displayMode: 'velocity' | 'pressure',
  windSpeed: number,
  fluidDensity = 1,
): { vmin: number; vmax: number } {
  if (displayMode === 'velocity') {
    return { vmin: 0, vmax: windSpeed * 1.8 };
  }
  const center = fluidDensity / 3;
  const halfSpan = windSpeed * 0.085;
  return { vmin: center - halfSpan, vmax: center + halfSpan };
}
