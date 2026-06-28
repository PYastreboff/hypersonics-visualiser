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

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Flow Visualiser</h1>
            <p className="subtitle">
              by Peter Yastreboff — interactive flow visualisation
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
        <main className="main-view">
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
