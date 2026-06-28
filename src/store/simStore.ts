import { create } from 'zustand';
import type {
  CombinedMetrics,
  FlowParams,
  HFRunState,
  LbmDisplayMode,
  LbmDrawDensity,
  LbmInteractionMode,
  LbmPhysicsMode,
  LbmPrerenderStatus,
  EulerTunnelStatus,
  LbmRunMode,
  LbmShapeInput,
  PlacedShape,
  ShapeKind,
  SimMode,
  SlicePlane,
  ViewMode,
} from '@/types';
import { getShapeDefinition } from '@/shapes/definitions';
import { computeAllMetrics } from '@/physics/drag';
import { defaultLbmShapes } from '@/physics/lbmObstacles';
import {
  removeBrushFromStencilSet,
  stencilArraysFromKeys,
  stencilKeysFromShape,
} from '@/physics/lbmDrawBrush';
import { lbmFrameToTime, lbmTotalFrames, clampLbmFluidDensity, clampEulerMach, clampTunnelNx, clampTunnelNy, snapLbmResolutionScale } from '@/physics/lbmConfig';

let shapeIdCounter = 0;

function defaultFlowParams(): FlowParams {
  return {
    mach: 2,
    altitude: 10000,
    angleOfAttack: 0,
    sideslip: 0,
    freeStreamTemp: null,
    wallThermalBC: 'adiabatic',
    wallTemp: 300,
  };
}

function defaultHFState(): HFRunState {
  return {
    status: 'idle',
    progress: 0,
    slicePlane: 'xz',
    gridNx: 256,
    gridNy: 128,
  };
}

interface SimState {
  flowParams: FlowParams;
  shapes: PlacedShape[];
  selectedShapeId: string | null;
  simMode: SimMode;
  viewMode: ViewMode;
  metrics: CombinedMetrics | null;
  showStreamlines: boolean;
  showShocks: boolean;
  showSlice: boolean;
  slicePlane: SlicePlane;
  sliceField: 'density' | 'temperature' | 'mach';
  showTransition: boolean;
  showBoundaryLayer: boolean;
  hfState: HFRunState;
  hfWorker: Worker | null;
  lbmPhysicsMode: LbmPhysicsMode;
  lbmDisplayMode: LbmDisplayMode;
  lbmWindSpeed: number;
  lbmFluidDensity: number;
  lbmEulerMach: number;
  lbmEulerAltitude: number;
  eulerTunnelStatus: EulerTunnelStatus;
  eulerTunnelProgress: number;
  eulerTunnelSeed: number;
  lbmResolutionScale: number;
  lbmTunnelNx: number;
  lbmTunnelNy: number;
  lbmPlaybackSeconds: number;
  lbmShapes: LbmShapeInput[];
  selectedLbmShapeId: string | null;
  hoveredLbmShapeId: string | null;
  lbmPlaying: boolean;
  lbmElapsedSec: number;
  lbmFrameIndex: number;
  lbmSeed: number;
  lbmRunMode: LbmRunMode;
  lbmPrerenderStatus: LbmPrerenderStatus;
  lbmPrerenderProgress: number;
  lbmRewind: number;
  lbmInteractionMode: LbmInteractionMode;
  lbmBrushRadius: number;
  lbmDrawDensity: LbmDrawDensity;

  setFlowParam: <K extends keyof FlowParams>(key: K, value: FlowParams[K]) => void;
  addShape: (kind: ShapeKind) => void;
  removeShape: (id: string) => void;
  selectShape: (id: string | null) => void;
  updateShapeTransform: (
    id: string,
    position?: [number, number, number],
    rotation?: [number, number, number],
    scale?: [number, number, number],
    recompute?: boolean,
  ) => void;
  addCustomShape: (name: string, geometryUrl: string) => void;
  recomputeMetrics: () => void;
  setSimMode: (mode: SimMode) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleStreamlines: () => void;
  toggleShocks: () => void;
  toggleSlice: () => void;
  setSlicePlane: (plane: SlicePlane) => void;
  setSliceField: (field: 'density' | 'temperature' | 'mach') => void;
  toggleTransition: () => void;
  toggleBoundaryLayer: () => void;
  setLbmDisplayMode: (mode: LbmDisplayMode) => void;
  setLbmPhysicsMode: (mode: LbmPhysicsMode) => void;
  setLbmEulerMach: (mach: number) => void;
  setLbmEulerAltitude: (altitude: number) => void;
  setEulerTunnelState: (
    state: Partial<{
      status: EulerTunnelStatus;
      progress: number;
    }>,
  ) => void;
  runEulerTunnelSimulation: () => void;
  setLbmWindSpeed: (speed: number) => void;
  setLbmFluidDensity: (density: number) => void;
  setLbmResolutionScale: (scale: number) => void;
  setLbmTunnelNx: (nx: number) => void;
  setLbmTunnelNy: (ny: number) => void;
  setLbmPlaybackSeconds: (seconds: number) => void;
  setLbmElapsedSec: (seconds: number) => void;
  setLbmFrameIndex: (frame: number) => void;
  seekLbmFrame: (frame: number) => void;
  updateLbmShape: (id: string, shape: LbmShapeInput) => void;
  updateLbmShapePosition: (id: string, cx: number, cy: number) => void;
  updateLbmShapeStencil: (id: string, stencilX: number[], stencilY: number[]) => void;
  applyLbmEraseBrush: (lx: number, ly: number, radius: number) => void;
  commitLbmShapeLayout: () => void;
  setSelectedLbmShapeId: (id: string | null) => void;
  setHoveredLbmShapeId: (id: string | null) => void;
  addLbmShape: (shape: LbmShapeInput) => void;
  removeLbmShape: (id: string) => void;
  setLbmRunMode: (mode: LbmRunMode) => void;
  setLbmPrerenderState: (
    state: Partial<{
      status: LbmPrerenderStatus;
      progress: number;
    }>,
  ) => void;
  setLbmPlaying: (playing: boolean) => void;
  toggleLbmPlaying: () => void;
  setLbmInteractionMode: (mode: LbmInteractionMode) => void;
  setLbmBrushRadius: (radius: number) => void;
  setLbmDrawDensity: (density: LbmDrawDensity) => void;
  resetLbmSimulation: () => void;
  runHighFidelity: () => void;
  cancelHighFidelity: () => void;
  setHFState: (state: Partial<HFRunState>) => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  flowParams: defaultFlowParams(),
  shapes: [],
  selectedShapeId: null,
  simMode: 'preview',
  viewMode: 'lbm',
  metrics: null,
  showStreamlines: true,
  showShocks: true,
  showSlice: false,
  slicePlane: 'xz',
  sliceField: 'mach',
  showTransition: true,
  showBoundaryLayer: false,
  hfState: defaultHFState(),
  hfWorker: null,
  lbmPhysicsMode: 'lbm',
  lbmDisplayMode: 'velocity',
  lbmWindSpeed: 0.1,
  lbmFluidDensity: 1,
  lbmEulerMach: 0.3,
  lbmEulerAltitude: 0,
  eulerTunnelStatus: 'idle',
  eulerTunnelProgress: 0,
  eulerTunnelSeed: 0,
  lbmResolutionScale: 1,
  lbmTunnelNx: 300,
  lbmTunnelNy: 100,
  lbmPlaybackSeconds: 6,
  lbmShapes: defaultLbmShapes(),
  selectedLbmShapeId: null,
  hoveredLbmShapeId: null,
  lbmPlaying: false,
  lbmElapsedSec: 0,
  lbmFrameIndex: 0,
  lbmSeed: 0,
  lbmRunMode: 'live',
  lbmPrerenderStatus: 'idle',
  lbmPrerenderProgress: 0,
  lbmRewind: 0,
  lbmInteractionMode: 'select',
  lbmBrushRadius: 2,
  lbmDrawDensity: 'increase',

  setFlowParam: (key, value) => {
    set((s) => {
      const flowParams = { ...s.flowParams, [key]: value };
      if (key === 'mach') {
        const m = flowParams.mach;
        flowParams.mach = Math.min(12, Math.max(0, Number.isFinite(m) ? m : 0));
      }
      return { flowParams };
    });
    get().recomputeMetrics();
  },

  addShape: (kind) => {
    const def = getShapeDefinition(kind);
    const id = `shape-${++shapeIdCounter}`;
    const shape: PlacedShape = {
      id,
      kind,
      name: `${def.label} ${shapeIdCounter}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      params: { ...def.defaultParams },
    };
    set((s) => ({
      shapes: [...s.shapes, shape],
      selectedShapeId: id,
    }));
    get().recomputeMetrics();
  },

  removeShape: (id) => {
    set((s) => ({
      shapes: s.shapes.filter((sh) => sh.id !== id),
      selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
    }));
    get().recomputeMetrics();
  },

  selectShape: (id) => set({ selectedShapeId: id }),

  updateShapeTransform: (id, position, rotation, scale, recompute = true) => {
    set((s) => ({
      shapes: s.shapes.map((sh) => {
        if (sh.id !== id) return sh;
        return {
          ...sh,
          position: position ?? sh.position,
          rotation: rotation ?? sh.rotation,
          scale: scale ?? sh.scale,
        };
      }),
    }));
    if (recompute) get().recomputeMetrics();
  },

  addCustomShape: (name, geometryUrl) => {
    const id = `shape-${++shapeIdCounter}`;
    const shape: PlacedShape = {
      id,
      kind: 'custom',
      name,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      params: { radius: 0.5 },
      customGeometryUrl: geometryUrl,
    };
    set((s) => ({
      shapes: [...s.shapes, shape],
      selectedShapeId: id,
    }));
    get().recomputeMetrics();
  },

  recomputeMetrics: () => {
    const { flowParams, shapes } = get();
    const metrics = computeAllMetrics(
      shapes,
      flowParams.mach,
      flowParams.altitude,
      flowParams.angleOfAttack,
      flowParams.freeStreamTemp,
    );
    set({ metrics });
  },

  setSimMode: (mode) => set({ simMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleStreamlines: () => set((s) => ({ showStreamlines: !s.showStreamlines })),
  toggleShocks: () => set((s) => ({ showShocks: !s.showShocks })),
  toggleSlice: () => set((s) => ({ showSlice: !s.showSlice })),
  setSlicePlane: (plane) => set({ slicePlane: plane }),
  setSliceField: (field) => set({ sliceField: field }),
  toggleTransition: () => set((s) => ({ showTransition: !s.showTransition })),
  toggleBoundaryLayer: () => set((s) => ({ showBoundaryLayer: !s.showBoundaryLayer })),
  setLbmDisplayMode: (mode) => set({ lbmDisplayMode: mode }),
  setLbmPhysicsMode: (mode) =>
    set((s) => ({
      lbmPhysicsMode: mode,
      lbmDisplayMode:
        mode === 'euler' && s.lbmDisplayMode === 'velocity'
          ? 'mach'
          : mode === 'lbm' && s.lbmDisplayMode === 'mach'
            ? 'velocity'
            : s.lbmDisplayMode,
      eulerTunnelStatus: mode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: mode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  setLbmEulerMach: (mach) =>
    set((s) => ({
      lbmEulerMach: clampEulerMach(mach),
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  setLbmEulerAltitude: (altitude) =>
    set((s) => ({
      lbmEulerAltitude: Math.min(50000, Math.max(0, altitude)),
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  setEulerTunnelState: (state) =>
    set((s) => ({
      eulerTunnelStatus: state.status ?? s.eulerTunnelStatus,
      eulerTunnelProgress: state.progress ?? s.eulerTunnelProgress,
    })),
  runEulerTunnelSimulation: () =>
    set((s) => ({
      eulerTunnelSeed: s.eulerTunnelSeed + 1,
      eulerTunnelStatus: 'idle',
    })),
  setLbmWindSpeed: (speed) =>
    set({ lbmWindSpeed: Math.min(0.15, Math.max(0, speed)) }),
  setLbmFluidDensity: (density) =>
    set({ lbmFluidDensity: clampLbmFluidDensity(density) }),
  setLbmResolutionScale: (scale) => {
    set((s) => ({
      lbmResolutionScale: snapLbmResolutionScale(scale),
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    }));
  },
  setLbmTunnelNx: (nx) => {
    set((s) => ({
      lbmTunnelNx: clampTunnelNx(nx),
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    }));
  },
  setLbmTunnelNy: (ny) => {
    set((s) => ({
      lbmTunnelNy: clampTunnelNy(ny),
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    }));
  },
  setLbmPlaybackSeconds: (seconds) =>
    set({
      lbmPlaybackSeconds: Math.min(60, Math.max(1, seconds)),
      lbmPrerenderStatus: get().lbmRunMode === 'prerender' ? 'idle' : get().lbmPrerenderStatus,
    }),
  setLbmElapsedSec: (seconds) => set({ lbmElapsedSec: seconds }),
  setLbmFrameIndex: (frame) =>
    set({ lbmFrameIndex: frame, lbmElapsedSec: lbmFrameToTime(frame) }),
  seekLbmFrame: (frame) =>
    set((s) => {
      const maxFrame = Math.max(0, lbmTotalFrames(s.lbmPlaybackSeconds) - 1);
      const clamped = Math.min(maxFrame, Math.max(0, Math.round(frame)));
      return {
        lbmPlaying: false,
        lbmFrameIndex: clamped,
        lbmElapsedSec: lbmFrameToTime(clamped),
      };
    }),
  updateLbmShape: (id, shape) =>
    set((s) => ({
      lbmShapes: s.lbmShapes.map((sh) => (sh.id === id ? shape : sh)),
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      lbmSeed:
        s.lbmPhysicsMode === 'lbm' && s.lbmRunMode === 'prerender'
          ? s.lbmSeed + 1
          : s.lbmSeed,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  updateLbmShapePosition: (id, cx, cy) =>
    set((s) => ({
      lbmShapes: s.lbmShapes.map((sh) =>
        sh.id === id ? { ...sh, cx: Math.round(cx), cy: Math.round(cy) } : sh,
      ),
    })),
  updateLbmShapeStencil: (id, stencilX, stencilY) =>
    set((s) => ({
      lbmShapes: s.lbmShapes.map((sh) =>
        sh.id === id ? { ...sh, stencilX, stencilY } : sh,
      ),
    })),
  applyLbmEraseBrush: (lx, ly, radius) =>
    set((s) => {
      const nextShapes: LbmShapeInput[] = [];
      let selectedLbmShapeId = s.selectedLbmShapeId;

      for (const shape of s.lbmShapes) {
        if (shape.type !== 'custom' || !shape.stencilX?.length || !shape.stencilY?.length) {
          nextShapes.push(shape);
          continue;
        }

        const keys = stencilKeysFromShape(shape);
        removeBrushFromStencilSet(keys, shape.cx, shape.cy, lx, ly, radius);
        if (keys.size === 0) {
          if (selectedLbmShapeId === shape.id) selectedLbmShapeId = null;
          continue;
        }

        const { stencilX, stencilY } = stencilArraysFromKeys(keys);
        nextShapes.push({ ...shape, stencilX, stencilY });
      }

      return { lbmShapes: nextShapes, selectedLbmShapeId };
    }),
  commitLbmShapeLayout: () =>
    set((s) => ({
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      lbmSeed:
        s.lbmPhysicsMode === 'lbm' && s.lbmRunMode === 'prerender'
          ? s.lbmSeed + 1
          : s.lbmSeed,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  setSelectedLbmShapeId: (id) => set({ selectedLbmShapeId: id }),
  setHoveredLbmShapeId: (id) => set({ hoveredLbmShapeId: id }),
  addLbmShape: (shape) =>
    set((s) => ({
      lbmShapes: [...s.lbmShapes, shape],
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  removeLbmShape: (id) =>
    set((s) => ({
      lbmShapes: s.lbmShapes.filter((sh) => sh.id !== id),
      selectedLbmShapeId: s.selectedLbmShapeId === id ? null : s.selectedLbmShapeId,
      hoveredLbmShapeId: s.hoveredLbmShapeId === id ? null : s.hoveredLbmShapeId,
      lbmPrerenderStatus: s.lbmRunMode === 'prerender' ? 'idle' : s.lbmPrerenderStatus,
      lbmPrerenderProgress: s.lbmRunMode === 'prerender' ? 0 : s.lbmPrerenderProgress,
      lbmSeed: s.lbmPhysicsMode === 'lbm' ? s.lbmSeed + 1 : s.lbmSeed,
      eulerTunnelStatus: s.lbmPhysicsMode === 'euler' ? 'idle' : s.eulerTunnelStatus,
      eulerTunnelSeed: s.lbmPhysicsMode === 'euler' ? s.eulerTunnelSeed + 1 : s.eulerTunnelSeed,
    })),
  setLbmRunMode: (mode) =>
    set({
      lbmRunMode: mode,
      lbmPrerenderStatus: mode === 'prerender' ? 'idle' : 'idle',
      lbmPrerenderProgress: 0,
      lbmPlaying: mode === 'live',
    }),
  setLbmPrerenderState: (state) =>
    set((s) => ({
      lbmPrerenderStatus: state.status ?? s.lbmPrerenderStatus,
      lbmPrerenderProgress: state.progress ?? s.lbmPrerenderProgress,
    })),
  toggleLbmPlaying: () => set((s) => ({ lbmPlaying: !s.lbmPlaying })),
  setLbmPlaying: (playing) => set({ lbmPlaying: playing }),
  setLbmInteractionMode: (mode) => set({ lbmInteractionMode: mode }),
  setLbmBrushRadius: (radius) =>
    set({ lbmBrushRadius: Math.min(8, Math.max(1, Math.round(radius))) }),
  setLbmDrawDensity: (density) => set({ lbmDrawDensity: density }),
  resetLbmSimulation: () =>
    set((s) => {
      if (s.lbmPhysicsMode === 'euler') {
        return {
          eulerTunnelSeed: s.eulerTunnelSeed + 1,
          eulerTunnelStatus: 'idle',
        };
      }
      if (s.lbmRunMode === 'prerender') {
        return {
          lbmPlaying: false,
          lbmFrameIndex: 0,
          lbmElapsedSec: 0,
          lbmSeed: s.lbmSeed + 1,
          lbmPrerenderStatus: 'idle',
          lbmPrerenderProgress: 0,
        };
      }
      return {
        lbmPlaying: true,
        lbmFrameIndex: 0,
        lbmElapsedSec: 0,
        lbmSeed: s.lbmSeed + 1,
      };
    }),

  runHighFidelity: () => {
    const { hfWorker, flowParams, shapes, hfState } = get();
    if (hfWorker) hfWorker.terminate();

    const worker = new Worker(
      new URL('../workers/eulerSolver.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'progress') {
        get().setHFState({ progress: data.progress, status: 'running' });
      } else if (data.type === 'complete') {
        get().setHFState({
          status: 'complete',
          progress: 1,
          density: data.density,
          pressure: data.pressure,
          mach: data.mach,
          temperature: data.temperature,
          gridNx: data.gridNx,
          gridNy: data.gridNy,
        });
      } else if (data.type === 'error') {
        get().setHFState({ status: 'error', error: data.error });
      } else if (data.type === 'cancelled') {
        get().setHFState({ status: 'cancelled', progress: 0 });
      }
    };

    set({
      hfWorker: worker,
      hfState: { ...hfState, status: 'running', progress: 0 },
      simMode: 'highFidelity',
    });

    worker.postMessage({
      type: 'run',
      mach: flowParams.mach,
      altitude: flowParams.altitude,
      slicePlane: hfState.slicePlane,
      shapes: shapes.map((s) => ({
        kind: s.kind,
        position: s.position,
        scale: s.scale,
        params: s.params,
      })),
      gridNx: hfState.gridNx,
      gridNy: hfState.gridNy,
    });
  },

  cancelHighFidelity: () => {
    const { hfWorker } = get();
    if (hfWorker) {
      hfWorker.postMessage({ type: 'cancel' });
      hfWorker.terminate();
    }
    set({ hfWorker: null, hfState: { ...get().hfState, status: 'cancelled' } });
  },

  setHFState: (state) => set((s) => ({ hfState: { ...s.hfState, ...state } })),
}));

useSimStore.getState().recomputeMetrics();
