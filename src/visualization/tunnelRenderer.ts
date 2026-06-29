import type { LbmDisplayMode, LbmPhysicsMode } from '@/types';
import {
  lbmObstacleColor,
  resolveTunnelMetricRange,
  tunnelMetricColor,
} from '@/visualization/jetColormap';

export function fitDrawRect(
  containerW: number,
  containerH: number,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const containerAspect = containerW / containerH;
  if (containerAspect > aspect) {
    const h = containerH;
    const w = h * aspect;
    return { x: (containerW - w) / 2, y: 0, w, h };
  }
  const w = containerW;
  const h = w / aspect;
  return { x: 0, y: (containerH - h) / 2, w, h };
}

export interface TunnelRenderParams {
  metric: Float32Array;
  obstacle: Uint8Array;
  nx: number;
  ny: number;
  displayMode: LbmDisplayMode;
  physicsMode: LbmPhysicsMode;
  windSpeed: number;
  fluidDensity?: number;
  eulerMach?: number;
  eulerAltitude?: number;
  highlightMask?: Uint8Array | null;
}

export function buildTunnelImageData(params: TunnelRenderParams): {
  image: ImageData;
  vmin: number;
  vmax: number;
} {
  const {
    metric,
    obstacle,
    nx,
    ny,
    displayMode,
    physicsMode,
    windSpeed,
    fluidDensity = 1,
    eulerMach = 0.3,
    eulerAltitude = 0,
    highlightMask = null,
  } = params;

  const { vmin, vmax } = resolveTunnelMetricRange(
    physicsMode,
    displayMode,
    windSpeed,
    fluidDensity,
    eulerMach,
    eulerAltitude,
    metric,
    obstacle,
  );
  const range = Math.max(vmax - vmin, 1e-9);
  const image = new ImageData(nx, ny);

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const idx = x * ny + y;
      const px = x;
      const py = ny - 1 - y;
      const out = (py * nx + px) * 4;

      if (obstacle[idx]) {
        const [r, g, b] = lbmObstacleColor(displayMode, Boolean(highlightMask?.[idx]), physicsMode);
        image.data[out] = r;
        image.data[out + 1] = g;
        image.data[out + 2] = b;
        image.data[out + 3] = 255;
        continue;
      }

      const t = (metric[idx] - vmin) / range;
      const [r, g, b] = tunnelMetricColor(displayMode, t);
      image.data[out] = r;
      image.data[out + 1] = g;
      image.data[out + 2] = b;
      image.data[out + 3] = 255;
    }
  }

  return { image, vmin, vmax };
}

export function renderTunnelFrame(
  ctx: CanvasRenderingContext2D,
  params: TunnelRenderParams,
  containerW: number,
  containerH: number,
  gridCanvas: HTMLCanvasElement | OffscreenCanvas,
): { vmin: number; vmax: number } {
  const { nx, ny } = params;
  const { image, vmin, vmax } = buildTunnelImageData(params);

  if (gridCanvas instanceof HTMLCanvasElement) {
    gridCanvas.width = nx;
    gridCanvas.height = ny;
  } else {
    gridCanvas.width = nx;
    gridCanvas.height = ny;
  }

  const gridCtx = gridCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  gridCtx.putImageData(image, 0, 0);

  const rect = fitDrawRect(containerW, containerH, nx / ny);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, containerW, containerH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(gridCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
  return { vmin, vmax };
}

export async function renderTunnelBitmap(
  params: TunnelRenderParams,
): Promise<{ bitmap: ImageBitmap; vmin: number; vmax: number }> {
  const { nx, ny } = params;
  const { image, vmin, vmax } = buildTunnelImageData(params);
  const canvas = new OffscreenCanvas(nx, ny);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas unavailable');
  ctx.putImageData(image, 0, 0);
  const bitmap = canvas.transferToImageBitmap();
  return { bitmap, vmin, vmax };
}

export function blitTunnelBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  nx: number,
  ny: number,
  containerW: number,
  containerH: number,
): void {
  const rect = fitDrawRect(containerW, containerH, nx / ny);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, containerW, containerH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
}

/** Skip metric transfer for very large grids — hover reads may lag one frame. */
export function shouldTransferLiveMetric(nx: number, ny: number): boolean {
  return nx * ny <= 120_000;
}
