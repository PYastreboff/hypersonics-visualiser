/** Matplotlib-style jet colormap (t in [0, 1]). */
export function jetColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function metricRange(
  displayMode: 'velocity' | 'pressure',
  windSpeed: number,
): { vmin: number; vmax: number } {
  if (displayMode === 'velocity') {
    return { vmin: 0, vmax: windSpeed * 1.8 };
  }
  return {
    vmin: 0.33 - windSpeed * 0.05,
    vmax: 0.333 + windSpeed * 0.12,
  };
}
