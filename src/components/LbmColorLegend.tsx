import { useEffect, useMemo, useRef, useState } from 'react';
import type { LbmDisplayMode } from '@/types';
import { lbmMetricColor, metricRange } from '@/visualization/jetColormap';
import { lbmDisplayModeLabel, formatLbmLegendValue, lbmLegendUnitLabel } from '@/physics/lbmConfig';

const TICK_COUNT = 5;
const BAR_HEIGHT = 20;

function legendTicks(vmin: number, vmax: number, count: number): number[] {
  if (count < 2) return [vmin];
  return Array.from({ length: count }, (_, i) => vmin + (i / (count - 1)) * (vmax - vmin));
}

function paintLegendBar(
  canvas: HTMLCanvasElement,
  width: number,
  displayMode: LbmDisplayMode,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || width <= 0) return;

  canvas.width = width;
  canvas.height = BAR_HEIGHT;

  const image = ctx.createImageData(width, BAR_HEIGHT);

  for (let x = 0; x < width; x++) {
    const t = x / Math.max(width - 1, 1);
    const [r, g, b] = lbmMetricColor(displayMode, t);
    for (let y = 0; y < BAR_HEIGHT; y++) {
      const i = (y * width + x) * 4;
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
  fluidDensity = 1,
}: {
  displayMode: LbmDisplayMode;
  windSpeed: number;
  fluidDensity?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  const { vmin, vmax } = metricRange(displayMode, windSpeed, fluidDensity);
  const ticks = useMemo(() => legendTicks(vmin, vmax, TICK_COUNT), [vmin, vmax]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const updateWidth = () => {
      setBarWidth(Math.max(0, Math.floor(wrap.clientWidth)));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || barWidth <= 0) return;
    paintLegendBar(canvas, barWidth, displayMode);
  }, [displayMode, barWidth]);

  return (
    <div
      className="lbm-color-legend"
      aria-label={`${lbmDisplayModeLabel(displayMode)} colour scale`}
    >
      <span className="lbm-legend-title">{lbmDisplayModeLabel(displayMode)} scale</span>
      <div ref={wrapRef} className="lbm-legend-bar-wrap">
        <canvas ref={canvasRef} className="lbm-legend-canvas" aria-hidden />
      </div>
      {barWidth > 0 && (
        <div className="lbm-legend-ticks" style={{ width: barWidth }}>
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
      )}
      <span className="lbm-legend-unit">{lbmLegendUnitLabel(displayMode)}</span>
    </div>
  );
}
