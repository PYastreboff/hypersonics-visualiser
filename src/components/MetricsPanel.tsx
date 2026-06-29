import { useSimStore } from '@/store/simStore';
import { regimeLabel } from '@/physics/regimes';

export function MetricsPanel() {
  const { metrics, shapes } = useSimStore();

  if (!metrics) {
    return (
      <div className="panel metrics-panel">
        <h3>Aerodynamics</h3>
        <p className="empty">Add shapes to see drag and flow metrics.</p>
      </div>
    );
  }

  return (
    <div className="panel metrics-panel">
      <h3>Aerodynamics</h3>

      <div className="metrics-summary">
        <div className="metric-card">
          <span className="label">Regime</span>
          <span className="value regime">{regimeLabel(metrics.regime)}</span>
        </div>
        <div className="metric-card">
          <span className="label">Reynolds</span>
          <span className="value">{metrics.reynolds.toExponential(2)}</span>
        </div>
        <div className="metric-card">
          <span className="label" title="Free-stream dynamic pressure">
            q∞
          </span>
          <span className="value">{(metrics.dynamicPressure / 1000).toFixed(1)} kPa</span>
        </div>
        <div className="metric-card">
          <span className="label">Stagnation T</span>
          <span className="value">{metrics.stagnationTemp.toFixed(0)} K</span>
        </div>
      </div>

      <div className="metrics-totals">
        <div className="total-row">
          <span title="Total drag coefficient">Total Cd</span>
          <strong>{metrics.totalCd.toFixed(4)}</strong>
        </div>
        <div className="total-row">
          <span title="Total lift coefficient">Total Cl</span>
          <strong>{metrics.totalCl.toFixed(4)}</strong>
        </div>
        {shapes.length > 1 && (
          <div className="total-row interference">
            <span>Interference</span>
            <strong>{metrics.interferenceFactor.toFixed(2)}</strong>
            {metrics.interferenceFactor < 0.9 && (
              <span className="badge warn">Estimate only</span>
            )}
          </div>
        )}
      </div>

      {metrics.shapes.length > 0 && (
        <div className="shape-metrics-list">
          {metrics.shapes.map((m) => (
            <div key={m.shapeId} className="shape-metrics-card">
              <div className="shape-metrics-card-title">{m.name}</div>
              <dl className="shape-metrics-rows">
                <div className="shape-metrics-row">
                  <dt title="Drag coefficient">Cd</dt>
                  <dd>{m.cd.toFixed(3)}</dd>
                </div>
                <div className="shape-metrics-row">
                  <dt title="Lift coefficient">Cl</dt>
                  <dd>{m.cl.toFixed(3)}</dd>
                </div>
                <div className="shape-metrics-row">
                  <dt title="Pressure drag">Cp drag</dt>
                  <dd>{m.pressureDrag.toFixed(3)}</dd>
                </div>
                <div className="shape-metrics-row">
                  <dt title="Skin friction drag">Cf drag</dt>
                  <dd>{m.frictionDrag.toFixed(4)}</dd>
                </div>
                <div className="shape-metrics-row">
                  <dt title="Max adiabatic wall temperature">T wall</dt>
                  <dd>{m.maxWallTemp.toFixed(0)} K</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="transition-legend">
        <span className="legend-title">Transition bands</span>
        <div className="legend-items">
          <span className="legend-item laminar">Laminar</span>
          <span className="legend-item transitional">Transitional</span>
          <span className="legend-item turbulent">Turbulent</span>
        </div>
        <span className="legend-note">Colours on the body surface only — not a separate ring</span>
      </div>
    </div>
  );
}
