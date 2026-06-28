import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simStore';
import { LbmSolver } from '@/physics/lbmSolver';
import {
  buildObstacleMask,
  lbmInputToSpec,
  scaleShapeSpecs,
} from '@/physics/lbmObstacles';
import { findShapeAtGrid, screenToGrid } from '@/physics/lbmHitTest';
import { lbmGridSize, lbmTotalFrames, LBM_FRAME_MS, lbmDisplayModeLabel, lbmRunModeLabel } from '@/physics/lbmConfig';
import {
  getPrerenderFrame,
  type LbmPrerenderResult,
} from '@/physics/lbmPrerender';
import { jetColor, metricRange } from '@/visualization/jetColormap';
import { LbmColorLegend } from './LbmColorLegend';

function fitDrawRect(
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

function renderFrame(
  ctx: CanvasRenderingContext2D,
  metric: Float32Array,
  obstacle: Uint8Array,
  nx: number,
  ny: number,
  displayMode: 'velocity' | 'pressure',
  windSpeed: number,
  containerW: number,
  containerH: number,
  offscreen: HTMLCanvasElement,
  highlightMask: Uint8Array | null = null,
): void {
  const { vmin, vmax } = metricRange(displayMode, windSpeed);
  const range = Math.max(vmax - vmin, 1e-9);
  const image = offscreen.getContext('2d')!.createImageData(nx, ny);
  const gray = Math.round(0.75 * 255);
  const highlightGray = Math.round(0.88 * 255);

  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      const idx = x * ny + y;
      const px = x;
      const py = ny - 1 - y;
      const out = (py * nx + px) * 4;

      if (obstacle[idx]) {
        if (highlightMask?.[idx]) {
          image.data[out] = highlightGray;
          image.data[out + 1] = highlightGray;
          image.data[out + 2] = highlightGray;
        } else {
          image.data[out] = gray;
          image.data[out + 1] = gray;
          image.data[out + 2] = gray;
        }
        image.data[out + 3] = 255;
        continue;
      }

      const t = (metric[idx] - vmin) / range;
      const [r, g, b] = jetColor(t);
      image.data[out] = r;
      image.data[out + 1] = g;
      image.data[out + 2] = b;
      image.data[out + 3] = 255;
    }
  }

  offscreen.width = nx;
  offscreen.height = ny;
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(image, 0, 0);

  const rect = fitDrawRect(containerW, containerH, nx / ny);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, containerW, containerH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, rect.x, rect.y, rect.w, rect.h);
}

export function LbmTunnelView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const solverRef = useRef<LbmSolver | null>(null);
  const obstacleRef = useRef<Uint8Array | null>(null);
  const prerenderRef = useRef<LbmPrerenderResult | null>(null);
  const prerenderWorkerRef = useRef<Worker | null>(null);
  const dragRef = useRef<{
    shapeId: string;
    startGx: number;
    startGy: number;
    origCx: number;
    origCy: number;
    wasPlaying: boolean;
  } | null>(null);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);
  const hoverMaskRef = useRef<Uint8Array | null>(null);

  const {
    lbmShapes,
    lbmDisplayMode,
    lbmWindSpeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    lbmPlaybackSeconds,
    lbmPlaying,
    lbmSeed,
    lbmRewind,
    lbmRunMode,
    lbmPrerenderStatus,
    lbmPrerenderProgress,
    lbmElapsedSec,
    setLbmFrameIndex,
    setLbmPrerenderState,
    setLbmPlaying,
    updateLbmShapePosition,
    commitLbmShapeLayout,
    setSelectedLbmShapeId,
    hoveredLbmShapeId,
    setHoveredLbmShapeId,
  } = useSimStore();

  const [isDragging, setIsDragging] = useState(false);

  const { nx, ny, renderStep } = lbmGridSize(lbmTunnelNx, lbmTunnelNy, lbmResolutionScale);
  const totalFrames = lbmTotalFrames(lbmPlaybackSeconds);

  const getOffscreen = useCallback(() => {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    return offscreenRef.current;
  }, []);

  const buildObstacle = useCallback(() => {
    const specs = scaleShapeSpecs(
      lbmShapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    return buildObstacleMask(nx, ny, specs);
  }, [lbmShapes, nx, ny, lbmResolutionScale]);

  const updateHoverHighlight = useCallback(
    (shapeId: string | null) => {
      if (!shapeId) {
        hoverMaskRef.current = null;
        return;
      }
      const shape = useSimStore.getState().lbmShapes.find((s) => s.id === shapeId);
      if (!shape) {
        hoverMaskRef.current = null;
        return;
      }
      const specs = scaleShapeSpecs([lbmInputToSpec(shape)], lbmResolutionScale);
      hoverMaskRef.current = buildObstacleMask(nx, ny, specs);
    },
    [lbmResolutionScale, nx, ny],
  );

  const paintMetric = useCallback(
    (metric: Float32Array) => {
      const canvas = canvasRef.current;
      const obstacle = obstacleRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !obstacle || !ctx) return;

      renderFrame(
        ctx,
        metric,
        obstacle,
        nx,
        ny,
        lbmDisplayMode,
        lbmWindSpeed,
        canvas.width,
        canvas.height,
        getOffscreen(),
        hoverMaskRef.current,
      );
    },
    [lbmDisplayMode, lbmWindSpeed, nx, ny, getOffscreen],
  );

  const paintCurrent = useCallback(() => {
    if (lbmRunMode === 'prerender' && prerenderRef.current) {
      paintMetric(
        getPrerenderFrame(prerenderRef.current, frameRef.current, lbmDisplayMode),
      );
      return;
    }
    const solver = solverRef.current;
    if (!solver) return;
    paintMetric(solver.getMetric(lbmDisplayMode));
  }, [lbmRunMode, lbmDisplayMode, paintMetric]);

  const rebuildObstacleVisual = useCallback(() => {
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    const newMask = buildObstacleMask(nx, ny, specs);
    let obstacle = obstacleRef.current;
    if (!obstacle || obstacle.length !== newMask.length) {
      obstacle = new Uint8Array(newMask);
      obstacleRef.current = obstacle;
    } else {
      obstacle.set(newMask);
    }
    solverRef.current?.updateObstacle(obstacle);
    return obstacle;
  }, [nx, ny, lbmResolutionScale]);

  const resetLiveSimulation = useCallback(() => {
    const shapes = useSimStore.getState().lbmShapes;
    const specs = scaleShapeSpecs(
      shapes.map(lbmInputToSpec),
      lbmResolutionScale,
    );
    const obstacle = buildObstacleMask(nx, ny, specs);
    obstacleRef.current = obstacle;
    solverRef.current = new LbmSolver({ nx, ny, windSpeed: lbmWindSpeed }, obstacle);
    frameRef.current = 0;
    setLbmFrameIndex(0);
    paintMetric(solverRef.current.getMetric(lbmDisplayMode));
  }, [nx, ny, lbmResolutionScale, lbmWindSpeed, lbmDisplayMode, paintMetric, setLbmFrameIndex]);

  const cancelPrerender = useCallback(() => {
    if (prerenderWorkerRef.current) {
      prerenderWorkerRef.current.postMessage({ type: 'cancel' });
      prerenderWorkerRef.current.terminate();
      prerenderWorkerRef.current = null;
    }
  }, []);

  const startPrerender = useCallback(() => {
    cancelPrerender();
    prerenderRef.current = null;

    const obstacle = buildObstacle();
    obstacleRef.current = obstacle;
    const obstacleCopy = new Uint8Array(obstacle);

    setLbmPrerenderState({ status: 'running', progress: 0 });
    setLbmPlaying(false);
    frameRef.current = 0;
    setLbmFrameIndex(0);

    const worker = new Worker(
      new URL('../workers/lbmPrerender.worker.ts', import.meta.url),
      { type: 'module' },
    );
    prerenderWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'progress') {
        setLbmPrerenderState({ progress: data.progress });
      } else if (data.type === 'complete') {
        prerenderRef.current = {
          velocityFrames: data.velocityFrames,
          pressureFrames: data.pressureFrames,
          totalFrames: data.totalFrames,
          nx: data.nx,
          ny: data.ny,
        };
        setLbmPrerenderState({ status: 'ready', progress: 1 });
        frameRef.current = 0;
        setLbmFrameIndex(0);
        setLbmPlaying(true);
        paintMetric(
          getPrerenderFrame(prerenderRef.current, 0, lbmDisplayMode),
        );
        worker.terminate();
        prerenderWorkerRef.current = null;
      } else if (data.type === 'error') {
        setLbmPrerenderState({ status: 'error', progress: 0 });
        worker.terminate();
        prerenderWorkerRef.current = null;
      } else if (data.type === 'cancelled') {
        setLbmPrerenderState({ status: 'cancelled', progress: 0 });
        worker.terminate();
        prerenderWorkerRef.current = null;
      }
    };

    worker.postMessage(
      {
        type: 'run',
        nx,
        ny,
        windSpeed: lbmWindSpeed,
        renderStep,
        playbackSeconds: lbmPlaybackSeconds,
        obstacle: obstacleCopy.buffer,
      },
      [obstacleCopy.buffer],
    );
  }, [
    buildObstacle,
    cancelPrerender,
    lbmDisplayMode,
    lbmPlaybackSeconds,
    lbmWindSpeed,
    nx,
    ny,
    paintMetric,
    renderStep,
    setLbmFrameIndex,
    setLbmPlaying,
    setLbmPrerenderState,
  ]);

  useEffect(() => {
    if (lbmRunMode !== 'prerender') return;
    startPrerender();
    return () => cancelPrerender();
  }, [
    lbmRunMode,
    lbmSeed,
    lbmShapes,
    lbmWindSpeed,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    lbmPlaybackSeconds,
    nx,
    ny,
    renderStep,
    startPrerender,
    cancelPrerender,
  ]);

  useEffect(() => {
    if (lbmRunMode === 'prerender') return;
    resetLiveSimulation();
    setLbmPlaying(true);
  }, [lbmRunMode, lbmSeed, resetLiveSimulation, setLbmPlaying, lbmTunnelNx, lbmTunnelNy]);

  useEffect(() => {
    updateHoverHighlight(hoveredLbmShapeId);
    paintCurrent();
  }, [hoveredLbmShapeId, lbmShapes, lbmResolutionScale, updateHoverHighlight, paintCurrent]);

  useEffect(() => {
    if (lbmRunMode !== 'live' || !solverRef.current) return;
    rebuildObstacleVisual();
    paintCurrent();
  }, [lbmShapes, lbmRunMode, rebuildObstacleVisual, paintCurrent]);

  useEffect(() => {
    if (lbmRunMode !== 'prerender' || lbmPrerenderStatus !== 'ready' || !prerenderRef.current) return;
    frameRef.current = 0;
    setLbmFrameIndex(0);
    paintMetric(getPrerenderFrame(prerenderRef.current, 0, lbmDisplayMode));
  }, [lbmRewind, lbmRunMode, lbmPrerenderStatus, lbmDisplayMode, paintMetric, setLbmFrameIndex]);

  useEffect(() => {
    if (lbmRunMode !== 'prerender' || lbmPrerenderStatus !== 'ready') return;
    paintCurrent();
  }, [lbmRunMode, lbmPrerenderStatus, lbmDisplayMode, paintCurrent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      paintCurrent();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [paintCurrent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);

      if (!lbmPlaying) return;
      if (lbmRunMode === 'prerender' && lbmPrerenderStatus !== 'ready') return;

      if (lastTickRef.current === 0) {
        lastTickRef.current = now;
        return;
      }
      if (now - lastTickRef.current < LBM_FRAME_MS) return;
      lastTickRef.current = now;

      if (lbmRunMode === 'prerender' && prerenderRef.current) {
        const nextFrame = (frameRef.current + 1) % prerenderRef.current.totalFrames;
        frameRef.current = nextFrame;
        setLbmFrameIndex(nextFrame);
        paintMetric(
          getPrerenderFrame(prerenderRef.current, nextFrame, lbmDisplayMode),
        );
        return;
      }

      const solver = solverRef.current;
      if (!solver) return;

      for (let i = 0; i < renderStep; i++) {
        solver.step();
      }

      const nextFrame = frameRef.current + 1;
      frameRef.current = nextFrame;
      setLbmFrameIndex(nextFrame);
      paintMetric(solver.getMetric(lbmDisplayMode));
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTickRef.current = 0;
    };
  }, [
    lbmPlaying,
    lbmRunMode,
    lbmPrerenderStatus,
    lbmDisplayMode,
    renderStep,
    paintMetric,
    setLbmFrameIndex,
  ]);

  const showPrerenderPlaceholder =
    lbmRunMode === 'prerender' && lbmPrerenderStatus !== 'ready';

  const applyDragAt = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;

      const grid = screenToGrid(clientX, clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) return;

      const deltaGx = (grid.gx - drag.startGx) / lbmResolutionScale;
      const deltaGy = (grid.gy - drag.startGy) / lbmResolutionScale;
      updateLbmShapePosition(
        drag.shapeId,
        drag.origCx + deltaGx,
        drag.origCy + deltaGy,
      );
      rebuildObstacleVisual();
      updateHoverHighlight(drag.shapeId);
      paintCurrent();
    },
    [
      lbmResolutionScale,
      nx,
      ny,
      paintCurrent,
      rebuildObstacleVisual,
      updateHoverHighlight,
      updateLbmShapePosition,
    ],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    dragRef.current = null;
    setIsDragging(false);
    commitLbmShapeLayout();
    if (drag.wasPlaying) {
      setLbmPlaying(true);
    }
  }, [commitLbmShapeLayout, setLbmPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || showPrerenderPlaceholder) return;

    const onPointerDown = (e: PointerEvent) => {
      const grid = screenToGrid(e.clientX, e.clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) return;

      const shape = findShapeAtGrid(
        grid.gx,
        grid.gy,
        nx,
        ny,
        useSimStore.getState().lbmShapes,
        lbmResolutionScale,
      );
      if (!shape) {
        setSelectedLbmShapeId(null);
        return;
      }

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      setSelectedLbmShapeId(shape.id);
      setHoveredLbmShapeId(shape.id);
      const runMode = useSimStore.getState().lbmRunMode;
      const wasPlaying = useSimStore.getState().lbmPlaying;
      if (runMode !== 'live') {
        setLbmPlaying(false);
      }
      setIsDragging(true);
      dragRef.current = {
        shapeId: shape.id,
        startGx: grid.gx,
        startGy: grid.gy,
        origCx: shape.cx,
        origCy: shape.cy,
        wasPlaying,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (dragRef.current) {
        applyDragAt(e.clientX, e.clientY);
        return;
      }

      const grid = screenToGrid(e.clientX, e.clientY, canvas, nx, ny, fitDrawRect);
      if (!grid) {
        setHoveredLbmShapeId(null);
        return;
      }
      const shape = findShapeAtGrid(
        grid.gx,
        grid.gy,
        nx,
        ny,
        useSimStore.getState().lbmShapes,
        lbmResolutionScale,
      );
      setHoveredLbmShapeId(shape?.id ?? null);
    };

    const onPointerLeave = () => {
      if (!dragRef.current) {
        setHoveredLbmShapeId(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      endDrag();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [
    applyDragAt,
    endDrag,
    lbmResolutionScale,
    nx,
    ny,
    setHoveredLbmShapeId,
    setLbmPlaying,
    setSelectedLbmShapeId,
    showPrerenderPlaceholder,
  ]);

  const prerenderFrame = Math.min(
    totalFrames,
    Math.round(lbmPrerenderProgress * totalFrames),
  );

  return (
    <div className="lbm-container">
      <div className="lbm-title-bar">
        <span>
          Flow Visualiser | {lbmDisplayModeLabel(lbmDisplayMode)}
          {lbmRunMode === 'live' && <> | Time: {lbmElapsedSec.toFixed(1)}s</>}
          {lbmRunMode === 'prerender' && (
            <>
              {' '}
              | Time: {lbmElapsedSec.toFixed(1)}s / {lbmPlaybackSeconds.toFixed(1)}s
            </>
          )}
        </span>
        <span className="lbm-grid-label">
          {nx} × {ny} grid · {lbmShapes.length} obstacle{lbmShapes.length === 1 ? '' : 's'} ·{' '}
          {lbmRunModeLabel(lbmRunMode)}
        </span>
      </div>

      <div className="lbm-canvas-wrap">
        {showPrerenderPlaceholder && (
          <div className="lbm-placeholder">
            <div className="lbm-placeholder-inner">
              <strong>Pre-rendering simulation</strong>
              <p>
                {lbmPrerenderStatus === 'error'
                  ? 'Pre-render failed — adjust settings or switch to Live mode.'
                  : 'Computing all frames before playback.'}
              </p>
              {lbmPrerenderStatus !== 'error' && (
                <>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${lbmPrerenderProgress * 100}%` }}
                    />
                  </div>
                  <span>
                    Frame {prerenderFrame} / {totalFrames}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={[
            'lbm-canvas',
            showPrerenderPlaceholder ? 'lbm-canvas-hidden' : '',
            isDragging ? 'lbm-canvas-dragging' : hoveredLbmShapeId ? 'lbm-canvas-grab' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {!showPrerenderPlaceholder && (
          <LbmColorLegend displayMode={lbmDisplayMode} windSpeed={lbmWindSpeed} />
        )}
      </div>
      <div className="lbm-axis-labels">
        <span>Length</span>
        <span>Height</span>
      </div>
      {!showPrerenderPlaceholder && (
        <p className="lbm-drag-hint">Click and drag shapes to move them</p>
      )}
    </div>
  );
}
