export function cpToColor(cp: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (cp + 0.5) / 2.5));
  return [t, 0.15 + 0.4 * (1 - Math.abs(t - 0.5) * 2), 1 - t * 0.8];
}

export function tempToColor(tempK: number, tMin: number, tMax: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (tempK - tMin) / Math.max(tMax - tMin, 1)));
  if (t < 0.25) return [0, 0.2 + t * 3.2, 0.8 + t * 0.8];
  if (t < 0.5) return [0, 0.8 + (t - 0.25) * 0.8, 1 - (t - 0.25) * 2];
  if (t < 0.75) return [(t - 0.5) * 4, 1, 0.2];
  return [1, 1 - (t - 0.75) * 4, 0];
}

export function machToColor(mach: number, machMax: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, mach / machMax));
  return [0.2 + t * 0.8, 0.3 + (1 - t) * 0.5, 1 - t * 0.5];
}

export function densityToColor(rho: number, rhoMin: number, rhoMax: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (rho - rhoMin) / Math.max(rhoMax - rhoMin, 1e-6)));
  return [t * 0.9, t * 0.5, 1 - t * 0.7];
}

export function scalarFieldToRGBA(
  data: Float32Array,
  colorFn: (v: number) => [number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const [r, g, b] = colorFn(data[i]);
    rgba[i * 4] = Math.round(r * 255);
    rgba[i * 4 + 1] = Math.round(g * 255);
    rgba[i * 4 + 2] = Math.round(b * 255);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
