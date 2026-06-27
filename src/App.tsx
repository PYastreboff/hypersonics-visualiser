import { WindTunnelScene } from './components/WindTunnelScene';
import { ControlPanel } from './components/ControlPanel';
import { MetricsPanel } from './components/MetricsPanel';
import { ShapePalette } from './components/ShapePalette';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Hypersonics Visualiser</h1>
        <p className="subtitle">
          by Peter Yastreboff — virtual wind tunnel, Mach 0 to 10+
        </p>
      </header>
      <div className="app-layout">
        <aside className="sidebar left">
          <ShapePalette />
          <ControlPanel />
        </aside>
        <main className="main-view">
          <WindTunnelScene />
        </main>
        <aside className="sidebar right">
          <MetricsPanel />
        </aside>
      </div>
    </div>
  );
}
