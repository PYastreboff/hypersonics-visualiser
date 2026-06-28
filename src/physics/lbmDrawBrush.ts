/** Offsets from shape centre for each cell covered by a circular brush. */
export function brushStencilOffsets(
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  radius: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r = Math.max(0, Math.round(radius));
  const centerX = Math.round(lx);
  const centerY = Math.round(ly);

  for (let ox = -r; ox <= r; ox++) {
    for (let oy = -r; oy <= r; oy++) {
      if (ox * ox + oy * oy <= r * r) {
        out.push([centerX + ox - cx, centerY + oy - cy]);
      }
    }
  }

  return out;
}

export function addBrushToStencilSet(
  keys: Set<string>,
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  radius: number,
): void {
  for (const [dx, dy] of brushStencilOffsets(cx, cy, lx, ly, radius)) {
    keys.add(`${dx},${dy}`);
  }
}

export function removeBrushFromStencilSet(
  keys: Set<string>,
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  radius: number,
): void {
  const r = Math.max(0, Math.round(radius));
  const centerX = Math.round(lx);
  const centerY = Math.round(ly);

  for (const key of [...keys]) {
    const comma = key.indexOf(',');
    const dx = parseInt(key.slice(0, comma), 10);
    const dy = parseInt(key.slice(comma + 1), 10);
    const ox = cx + dx - centerX;
    const oy = cy + dy - centerY;
    if (ox * ox + oy * oy <= r * r) {
      keys.delete(key);
    }
  }
}

export function strokeLogicalPoints(
  from: { lx: number; ly: number } | null,
  to: { lx: number; ly: number },
): Array<{ lx: number; ly: number }> {
  if (!from) return [to];

  const dx = to.lx - from.lx;
  const dy = to.ly - from.ly;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const points: Array<{ lx: number; ly: number }> = [];

  for (let i = 0; i <= steps; i++) {
    points.push({
      lx: from.lx + (dx * i) / steps,
      ly: from.ly + (dy * i) / steps,
    });
  }

  return points;
}

export function stencilKeysFromShape(shape: {
  stencilX?: number[];
  stencilY?: number[];
}): Set<string> {
  const keys = new Set<string>();
  const stencilX = shape.stencilX;
  const stencilY = shape.stencilY;
  if (!stencilX?.length || !stencilY?.length) return keys;

  for (let i = 0; i < stencilX.length; i++) {
    keys.add(`${stencilX[i]},${stencilY[i]}`);
  }

  return keys;
}

export function stencilArraysFromKeys(keys: Set<string>): {
  stencilX: number[];
  stencilY: number[];
} {
  const stencilX: number[] = [];
  const stencilY: number[] = [];

  for (const key of keys) {
    const comma = key.indexOf(',');
    stencilX.push(parseInt(key.slice(0, comma), 10));
    stencilY.push(parseInt(key.slice(comma + 1), 10));
  }

  return { stencilX, stencilY };
}
