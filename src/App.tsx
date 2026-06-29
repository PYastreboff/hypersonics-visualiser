import { useEffect } from 'react';
import { useSimStore } from '@/store/simStore';
import { WindTunnelScene } from './components/WindTunnelScene';
import { LbmTunnelView } from './components/LbmTunnelView';
import { ControlPanel } from './components/ControlPanel';
import { LbmControlPanel } from './components/LbmControlPanel';
import { MetricsPanel } from './components/MetricsPanel';
import { ShapePalette } from './components/ShapePalette';

export default function App() {
  const viewMode = useSimStore((s) => s.viewMode);
  const setViewMode = useSimStore((s) => s.setViewMode);

  useEffect(() => {
    const blocksDeleteShortcut = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      if (target instanceof HTMLTextAreaElement) return true;
      if (target instanceof HTMLSelectElement) return true;
      if (target instanceof HTMLInputElement) {
        const type = target.type;
        return (
          type === 'text' ||
          type === 'number' ||
          type === 'search' ||
          type === 'password' ||
          type === 'email' ||
          type === 'url'
        );
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const state = useSimStore.getState();

      if (e.code === 'Space') {
        if (blocksDeleteShortcut(e.target)) return;
        if (state.viewMode !== 'lbm') return;
        if (state.lbmPhysicsMode === 'euler') {
          if (state.eulerRunMode === 'steady' && state.eulerTunnelStatus === 'running') return;
        } else if (state.lbmRunMode === 'prerender' && state.lbmPrerenderStatus !== 'ready') {
          return;
        }
        e.preventDefault();
        state.toggleLbmPlaying();
        return;
      }

      if (e.code !== 'Delete' && e.code !== 'Backspace') return;

      if (blocksDeleteShortcut(e.target)) return;

      if (state.viewMode === 'lbm') {
        const shapeId = state.selectedLbmShapeId ?? state.hoveredLbmShapeId;
        if (!shapeId) return;
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        state.removeLbmShape(shapeId);
        return;
      }

      if (!state.selectedShapeId) return;
      e.preventDefault();
      state.removeShape(state.selectedShapeId);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Flow Visualiser</h1>
            <p className="subtitle">
              by Peter Yastreboff — interactive CFD and hypersonic flow visualisation
            </p>
          </div>
          <div className="view-toggle">
            <button
              className={viewMode === 'lbm' ? 'active' : ''}
              onClick={() => setViewMode('lbm')}
              title="2D Lattice Boltzmann CFD"
            >
              LBM CFD
            </button>
            <button
              className={viewMode === '3d' ? 'active' : ''}
              onClick={() => setViewMode('3d')}
              title="Interactive 3D flow view (still in development)"
            >
              3D flow
              <span className="view-toggle-badge">In development</span>
            </button>
          </div>
        </div>
      </header>
      <div className="app-layout">
        <aside className={`sidebar left ${viewMode === 'lbm' ? 'lbm-sidebar' : ''}`}>
          {viewMode === 'lbm' ? <LbmControlPanel /> : (
            <>
              <ShapePalette />
              <ControlPanel />
            </>
          )}
        </aside>
        <main className="main-view" id="main-content" aria-label="Flow simulation viewport">
          {viewMode === 'lbm' ? <LbmTunnelView /> : <WindTunnelScene />}
        </main>
        {viewMode === '3d' && (
          <aside className="sidebar right">
            <MetricsPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
