import { useSimStore } from '@/store/simStore';
import { temperatureAtAltitude } from '@/physics/atmosphere';
import { SettingLabel } from './SettingLabel';

export function ControlPanel() {
  const {
    flowParams,
    setFlowParam,
    showStreamlines,
    showShocks,
    showSlice,
    showTransition,
    showBoundaryLayer,
    slicePlane,
    sliceField,
    toggleStreamlines,
    toggleShocks,
    toggleSlice,
    toggleTransition,
    toggleBoundaryLayer,
    setSlicePlane,
    setSliceField,
    runHighFidelity,
    cancelHighFidelity,
    hfState,
    simMode,
    setSimMode,
  } = useSimStore();

  const tempK = flowParams.freeStreamTemp ?? temperatureAtAltitude(flowParams.altitude);

  return (
    <div className="panel control-panel">
      <h2>Flow</h2>

      <div className="control-group">
        <SettingLabel
          label="Mach number"
          tip="Free-stream Mach number (0–12). Below 1 = subsonic, ~1 = transonic, 1–5 supersonic, 5+ hypersonic."
        >
          <input
            type="range"
            min={0}
            max={12}
            step={0.1}
            value={flowParams.mach}
            onChange={(e) => setFlowParam('mach', parseFloat(e.target.value) || 0)}
          />
          <input
            type="number"
            min={0}
            max={12}
            step={0.1}
            value={flowParams.mach}
            onChange={(e) => setFlowParam('mach', parseFloat(e.target.value) || 0)}
            className="num-input"
          />
        </SettingLabel>

        <SettingLabel
          label="Altitude (m)"
          tip="Flight altitude above sea level. Sets air density, temperature, and Reynolds number via the ISA atmosphere model."
        >
          <input
            type="range"
            min={0}
            max={50000}
            step={500}
            value={flowParams.altitude}
            onChange={(e) => setFlowParam('altitude', parseFloat(e.target.value))}
          />
          <span className="value">{flowParams.altitude.toLocaleString()} m</span>
        </SettingLabel>

        <SettingLabel
          label="Angle of attack (°)"
          tip="Body pitch relative to the free stream (+ nose up). Affects lift, shock angle, and the green flow-direction arrow."
        >
          <input
            type="range"
            min={-20}
            max={20}
            step={0.5}
            value={flowParams.angleOfAttack}
            onChange={(e) => setFlowParam('angleOfAttack', parseFloat(e.target.value))}
          />
          <span className="value">{flowParams.angleOfAttack.toFixed(1)}°</span>
        </SettingLabel>

        <SettingLabel
          label="Sideslip (°)"
          tip="Yaw angle of the free stream relative to the tunnel centreline. Rotates flow direction about the vertical axis."
        >
          <input
            type="range"
            min={-10}
            max={10}
            step={0.5}
            value={flowParams.sideslip}
            onChange={(e) => setFlowParam('sideslip', parseFloat(e.target.value))}
          />
          <span className="value">{flowParams.sideslip.toFixed(1)}°</span>
        </SettingLabel>

        <SettingLabel
          label="Free-stream temp (K)"
          tip="Static air temperature ahead of the body. Leave blank to use ISA temperature at the selected altitude."
        >
          <input
            type="number"
            placeholder={`Auto (${tempK.toFixed(1)})`}
            value={flowParams.freeStreamTemp ?? ''}
            onChange={(e) =>
              setFlowParam('freeStreamTemp', e.target.value ? parseFloat(e.target.value) : null)
            }
            className="num-input"
          />
        </SettingLabel>

        <SettingLabel
          label="Wall thermal BC"
          tip="Adiabatic: no heat transfer through the wall (recovery temperature). Isothermal: wall held at a fixed temperature."
        >
          <select
            value={flowParams.wallThermalBC}
            onChange={(e) =>
              setFlowParam('wallThermalBC', e.target.value as 'adiabatic' | 'isothermal')
            }
          >
            <option value="adiabatic">Adiabatic</option>
            <option value="isothermal">Isothermal</option>
          </select>
        </SettingLabel>
      </div>

      <div className="info-callout">
        <strong>Mach cone</strong> (blue wireframe at tunnel inlet, M &gt; 1): the cone half-angle is
        sin⁻¹(1/M). Information and disturbances from upstream can only affect points inside this
        cone — it marks the supersonic &quot;zone of influence&quot; of the inlet boundary.
      </div>

      <div className="control-group">
        <h4>Visualization (3D)</h4>
        <label className="checkbox" title="Static flow lines traced through the velocity field (recomputed when settings change)">
          <input type="checkbox" checked={showStreamlines} onChange={toggleStreamlines} />
          Streamlines
        </label>
        <label
          className="checkbox"
          title="Analytic oblique and bow shock surfaces attached to each shape's leading edge"
        >
          <input type="checkbox" checked={showShocks} onChange={toggleShocks} />
          Shock waves
        </label>
        <label className="checkbox" title="False-colour field slice through the tunnel (Mach, density, or temperature)">
          <input type="checkbox" checked={showSlice} onChange={toggleSlice} />
          Slice plane
        </label>
        <label
          className="checkbox"
          title="Surface colour bands: blue = laminar, yellow = transitional, orange = turbulent (by local Reₓ)"
        >
          <input type="checkbox" checked={showTransition} onChange={toggleTransition} />
          Transition bands
        </label>
        <label className="checkbox" title="Wireframe shell showing estimated boundary-layer thickness">
          <input type="checkbox" checked={showBoundaryLayer} onChange={toggleBoundaryLayer} />
          Boundary layer shell
        </label>

        {showSlice && (
          <>
            <SettingLabel label="Slice plane" tip="Orientation of the false-colour cut plane through the tunnel">
              <select value={slicePlane} onChange={(e) => setSlicePlane(e.target.value as 'xy' | 'xz' | 'yz')}>
                <option value="xz">XZ (side)</option>
                <option value="xy">XY (top)</option>
                <option value="yz">YZ (front)</option>
              </select>
            </SettingLabel>
            <SettingLabel label="Slice field" tip="Which quantity to colour the slice plane">
              <select
                value={sliceField}
                onChange={(e) => setSliceField(e.target.value as 'density' | 'temperature' | 'mach')}
              >
                <option value="mach">Mach</option>
                <option value="density">Density</option>
                <option value="temperature">Temperature</option>
              </select>
            </SettingLabel>
          </>
        )}
      </div>

      <div className="control-group hf-section">
        <h4>Simulation mode</h4>
        <div className="mode-toggle">
          <button
            className={simMode === 'preview' ? 'active' : ''}
            onClick={() => setSimMode('preview')}
            title="Real-time analytical flow preview"
          >
            Live preview
          </button>
          <button
            className={simMode === 'highFidelity' ? 'active' : ''}
            onClick={() => setSimMode('highFidelity')}
            title="Show results from the 2D Euler worker on the slice plane"
          >
            High-fidelity
          </button>
        </div>

        {hfState.status === 'running' ? (
          <div className="hf-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${hfState.progress * 100}%` }} />
            </div>
            <span>{Math.round(hfState.progress * 100)}%</span>
            <button onClick={cancelHighFidelity}>Cancel</button>
          </div>
        ) : (
          <button
            className="hf-run-btn"
            onClick={runHighFidelity}
            title="Run a 2D compressible Euler solve in a background worker (coarse grid, inviscid)"
          >
            Run high-fidelity (2D Euler)
          </button>
        )}
        {hfState.status === 'complete' && (
          <p className="hf-status success">HF run complete — enable slice plane to view</p>
        )}
        {hfState.status === 'error' && <p className="hf-status error">{hfState.error}</p>}
      </div>
    </div>
  );
}
