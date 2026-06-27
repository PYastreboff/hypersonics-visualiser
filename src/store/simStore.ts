import { create } from 'zustand';
import type {
  CombinedMetrics,
  FlowParams,
  HFRunState,
  PlacedShape,
  ShapeKind,
  SimMode,
  SlicePlane,
} from '@/types';
import { getShapeDefinition } from '@/shapes/definitions';
import { computeAllMetrics } from '@/physics/drag';

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
  toggleStreamlines: () => void;
  toggleShocks: () => void;
  toggleSlice: () => void;
  setSlicePlane: (plane: SlicePlane) => void;
  setSliceField: (field: 'density' | 'temperature' | 'mach') => void;
  toggleTransition: () => void;
  toggleBoundaryLayer: () => void;
  runHighFidelity: () => void;
  cancelHighFidelity: () => void;
  setHFState: (state: Partial<HFRunState>) => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  flowParams: defaultFlowParams(),
  shapes: [],
  selectedShapeId: null,
  simMode: 'preview',
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
  toggleStreamlines: () => set((s) => ({ showStreamlines: !s.showStreamlines })),
  toggleShocks: () => set((s) => ({ showShocks: !s.showShocks })),
  toggleSlice: () => set((s) => ({ showSlice: !s.showSlice })),
  setSlicePlane: (plane) => set({ slicePlane: plane }),
  setSliceField: (field) => set({ sliceField: field }),
  toggleTransition: () => set((s) => ({ showTransition: !s.showTransition })),
  toggleBoundaryLayer: () => set((s) => ({ showBoundaryLayer: !s.showBoundaryLayer })),

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
