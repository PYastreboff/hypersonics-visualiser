import { useSimStore } from '@/store/simStore';
import type { LbmShapeInput, LbmShapeType } from '@/types';
import {
  LBM_RESOLUTION_SCALES,
  LBM_MIN_TUNNEL_NX,
  LBM_MAX_TUNNEL_NX,
  LBM_MIN_TUNNEL_NY,
  LBM_MAX_TUNNEL_NY,
  lbmGridSize,
  lbmResolutionLabel,
  formatLbmSpeedMs,
} from '@/physics/lbmConfig';
import { SettingLabel } from './SettingLabel';
import { NumInput } from './NumInput';

let lbmShapeId = 100;

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="lbm-field">
      <span>{label}</span>
      <NumInput value={value} onChange={onChange} min={min} max={max} step={step} />
    </label>
  );
}

function ShapeCard({
  shape,
  index,
  selected,
  hovered,
  onChange,
  onRemove,
  onHover,
}: {
  shape: LbmShapeInput;
  index: number;
  selected: boolean;
  hovered: boolean;
  onChange: (shape: LbmShapeInput) => void;
  onRemove: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const setType = (type: LbmShapeType) => {
    const next: LbmShapeInput = { ...shape, type };
    if (type === 'airfoil') {
      next.chord = shape.chord ?? 80;
      next.naca = shape.naca ?? '0012';
    } else if (type === 'square') {
      next.width = shape.width ?? 20;
      next.height = shape.height ?? 20;
    } else {
      next.radius = shape.radius ?? 12;
    }
    onChange(next);
  };

  return (
    <div
      className={[
        'lbm-shape-card',
        selected ? 'selected' : '',
        hovered ? 'hovered' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="lbm-shape-card-header">
        <strong>Shape {index + 1}</strong>
        <button type="button" className="remove-btn" onClick={onRemove} title="Remove shape">
          ×
        </button>
      </div>

      <SettingLabel label="Shape type" tip="Geometry of this obstacle">
        <select value={shape.type} onChange={(e) => setType(e.target.value as LbmShapeType)}>
          <option value="airfoil">Airfoil</option>
          <option value="square">Square</option>
          <option value="circle">Circle</option>
        </select>
      </SettingLabel>

      <div className="lbm-field-grid">
        <NumField
          label="X position"
          value={shape.cx}
          onChange={(cx) => onChange({ ...shape, cx })}
        />
        <NumField
          label="Y position"
          value={shape.cy}
          onChange={(cy) => onChange({ ...shape, cy })}
        />
        <NumField
          label="Angle of attack (°)"
          value={shape.aoa}
          onChange={(aoa) => onChange({ ...shape, aoa })}
          step={0.5}
        />
      </div>

      {shape.type === 'airfoil' && (
        <div className="lbm-field-grid">
          <NumField
            label="Chord length"
            value={shape.chord ?? 80}
            onChange={(chord) => onChange({ ...shape, chord })}
            min={1}
          />
          <label className="lbm-field">
            <span>NACA profile</span>
            <input
              type="text"
              value={shape.naca ?? '0012'}
              onChange={(e) => onChange({ ...shape, naca: e.target.value })}
              className="num-input"
            />
          </label>
        </div>
      )}

      {shape.type === 'square' && (
        <div className="lbm-field-grid">
          <NumField
            label="Width"
            value={shape.width ?? 20}
            onChange={(width) => onChange({ ...shape, width })}
            min={1}
          />
          <NumField
            label="Height"
            value={shape.height ?? 20}
            onChange={(height) => onChange({ ...shape, height })}
            min={1}
          />
        </div>
      )}

      {shape.type === 'circle' && (
        <NumField
          label="Radius"
          value={shape.radius ?? 12}
          onChange={(radius) => onChange({ ...shape, radius })}
          min={1}
        />
      )}
    </div>
  );
}

export function LbmControlPanel() {
  const {
    lbmWindSpeed,
    lbmShapes,
    lbmPlaybackSeconds,
    lbmDisplayMode,
    lbmResolutionScale,
    lbmTunnelNx,
    lbmTunnelNy,
    lbmPlaying,
    lbmRunMode,
    lbmPrerenderStatus,
    selectedLbmShapeId,
    hoveredLbmShapeId,
    setLbmWindSpeed,
    setLbmPlaybackSeconds,
    setLbmDisplayMode,
    setLbmResolutionScale,
    setLbmTunnelNx,
    setLbmTunnelNy,
    setLbmRunMode,
    updateLbmShape,
    addLbmShape,
    removeLbmShape,
    toggleLbmPlaying,
    resetLbmSimulation,
    setHoveredLbmShapeId,
  } = useSimStore();

  const effectiveGrid = lbmGridSize(lbmTunnelNx, lbmTunnelNy, lbmResolutionScale);

  const addShape = () => {
    addLbmShape({
      id: `lbm-${++lbmShapeId}`,
      type: 'square',
      cx: 150,
      cy: 50,
      width: 20,
      height: 20,
      aoa: 0,
    });
  };

  return (
    <div className="panel control-panel lbm-control-panel">
      <h2>Simulation settings</h2>
      <p className="lbm-panel-desc">Flow, tunnel size, quality, and obstacles.</p>

      <div className="control-group">
        <h4>Flow</h4>

        <SettingLabel
          label="Wind speed (m/s)"
          tip="Inlet flow speed in metres per second (typical range 0.05–0.15 m/s)"
        >
          <input
            type="range"
            min={0.05}
            max={0.15}
            step={0.01}
            value={lbmWindSpeed}
            onChange={(e) => setLbmWindSpeed(parseFloat(e.target.value))}
          />
          <span className="value">{formatLbmSpeedMs(lbmWindSpeed)}</span>
        </SettingLabel>

        <SettingLabel label="Colour field" tip="What to show in the flow visualisation">
          <select
            value={lbmDisplayMode}
            onChange={(e) => setLbmDisplayMode(e.target.value as 'velocity' | 'pressure')}
          >
            <option value="velocity">Velocity</option>
            <option value="pressure">Pressure</option>
          </select>
        </SettingLabel>

        {lbmRunMode === 'prerender' && (
          <SettingLabel label="Playback duration" tip="Length of each animation loop, in seconds">
            <NumInput
              value={lbmPlaybackSeconds}
              onChange={setLbmPlaybackSeconds}
              min={1}
              max={60}
              step={0.5}
            />
            <span className="value">seconds</span>
          </SettingLabel>
        )}
      </div>

      <div className="control-group">
        <h4>Wind tunnel</h4>

        <SettingLabel
          label="Tunnel length"
          tip={`Horizontal size of the tunnel. Simulated grid: ${effectiveGrid.nx} cells wide`}
        >
          <input
            type="range"
            min={LBM_MIN_TUNNEL_NX}
            max={LBM_MAX_TUNNEL_NX}
            step={10}
            value={lbmTunnelNx}
            onChange={(e) => setLbmTunnelNx(parseInt(e.target.value, 10))}
          />
          <span className="value">{lbmTunnelNx} cells</span>
        </SettingLabel>

        <SettingLabel
          label="Tunnel height"
          tip={`Vertical size of the tunnel. Simulated grid: ${effectiveGrid.ny} cells tall`}
        >
          <input
            type="range"
            min={LBM_MIN_TUNNEL_NY}
            max={LBM_MAX_TUNNEL_NY}
            step={5}
            value={lbmTunnelNy}
            onChange={(e) => setLbmTunnelNy(parseInt(e.target.value, 10))}
          />
          <span className="value">{lbmTunnelNy} cells</span>
        </SettingLabel>

        <SettingLabel
          label="Simulation quality"
          tip="Higher quality is sharper but slower. Pre-render at Ultra or Extreme can take a while."
        >
          <select
            value={lbmResolutionScale}
            onChange={(e) => setLbmResolutionScale(parseFloat(e.target.value))}
          >
            {LBM_RESOLUTION_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {lbmResolutionLabel(scale, lbmTunnelNx, lbmTunnelNy)}
              </option>
            ))}
          </select>
        </SettingLabel>

        <SettingLabel
          label="Run mode"
          tip="Live steps physics in real time. Pre-render computes all frames first for smooth playback."
        >
          <div className="mode-toggle">
            <button
              type="button"
              className={lbmRunMode === 'live' ? 'active' : ''}
              onClick={() => setLbmRunMode('live')}
            >
              Live
            </button>
            <button
              type="button"
              className={lbmRunMode === 'prerender' ? 'active' : ''}
              onClick={() => setLbmRunMode('prerender')}
            >
              Pre-render
            </button>
          </div>
        </SettingLabel>

        {lbmRunMode === 'prerender' && lbmPrerenderStatus === 'ready' && (
          <p className="hf-status success">Pre-render complete — ready to play</p>
        )}
      </div>

      <div className="control-group">
        <div className="lbm-shapes-header">
          <h4>Obstacles</h4>
          <button type="button" className="shape-btn" onClick={addShape}>
            + Add shape
          </button>
        </div>

        {lbmShapes.map((shape, index) => (
          <ShapeCard
            key={shape.id}
            shape={shape}
            index={index}
            selected={shape.id === selectedLbmShapeId}
            hovered={shape.id === hoveredLbmShapeId}
            onChange={(next) => updateLbmShape(shape.id, next)}
            onRemove={() => removeLbmShape(shape.id)}
            onHover={(isHovered) =>
              setHoveredLbmShapeId(isHovered ? shape.id : null)
            }
          />
        ))}
      </div>

      <div className="lbm-controls-row">
        <button
          type="button"
          className="hf-run-btn"
          onClick={toggleLbmPlaying}
          disabled={lbmRunMode === 'prerender' && lbmPrerenderStatus !== 'ready'}
        >
          {lbmPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="shape-btn" onClick={resetLbmSimulation}>
          Reset
        </button>
      </div>
    </div>
  );
}
