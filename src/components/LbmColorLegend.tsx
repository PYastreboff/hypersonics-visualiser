import { useEffect, useMemo, useRef } from 'react';
import type { LbmDisplayMode } from '@/types';
import { jetColor, metricRange } from '@/visualization/jetColormap';
import { lbmDisplayModeLabel, formatLbmLegendValue, lbmLegendUnitLabel } from '@/physics/lbmConfig';

const TICK_COUNT = 5;
const BAR_WIDTH = 320;
const BAR_HEIGHT = 18;

function legendTicks(vmin: number, vmax: number, count: number): number[] {
  if (count < 2) return [vmin];
  return Array.from({ length: count }, (_, i) => vmin + (i / (count - 1)) * (vmax - vmin));
}

function paintLegendBar(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.createImageData(w, h);

  for (let x = 0; x < w; x++) {
    const t = x / Math.max(w - 1, 1);
    const [r, g, b] = jetColor(t);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

export function LbmColorLegend({
  displayMode,
  windSpeed,
}: {
  displayMode: LbmDisplayMode;
  windSpeed: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { vmin, vmax } = metricRange(displayMode, windSpeed);
  const ticks = useMemo(() => legendTicks(vmin, vmax, TICK_COUNT), [vmin, vmax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintLegendBar(canvas);
  }, [displayMode, windSpeed]);

  return (
    <div
      className="lbm-color-legend"
      aria-label={`${lbmDisplayModeLabel(displayMode)} colour scale`}
    >
      <span className="lbm-legend-title">{lbmDisplayModeLabel(displayMode)} scale</span>
      <canvas
        ref={canvasRef}
        className="lbm-legend-canvas"
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
        aria-hidden
      />
      <div className="lbm-legend-ticks" style={{ width: BAR_WIDTH }}>
        {ticks.map((value, i) => (
          <span
            key={i}
            className="lbm-legend-tick"
            style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
          >
            {formatLbmLegendValue(displayMode, value)}
          </span>
        ))}
      </div>
      <span className="lbm-legend-unit">{lbmLegendUnitLabel(displayMode)}</span>
    </div>
  );
}
