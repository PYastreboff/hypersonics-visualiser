import { useMemo, Fragment } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Text, Html } from '@react-three/drei';
import { useSimStore } from '@/store/simStore';
import { StreamlineParticles } from './StreamlineParticles';
import { ShapeMesh, BoundaryLayerShell } from './ShapeMesh';
import { ShockSurfaces } from './ShockSurfaces';
import { SlicePlaneView } from './SlicePlaneView';
import { detectRegime } from '@/physics/regimes';
import { getFlowQuaternion } from '@/physics/flowDirection';

const INLET_X = -5.5;

function FlowDirectionIndicators() {
  const { flowParams } = useSimStore();
  const flowQuat = useMemo(
    () => getFlowQuaternion(flowParams.angleOfAttack, flowParams.sideslip),
    [flowParams.angleOfAttack, flowParams.sideslip],
  );

  return (
    <group position={[INLET_X, 0, 0]} quaternion={flowQuat}>
      <mesh position={[0.75, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.5, 8]} />
        <meshBasicMaterial color="#66ff88" />
      </mesh>
      <mesh position={[1.55, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.12, 0.3, 8]} />
        <meshBasicMaterial color="#66ff88" />
      </mesh>
      <Text position={[0, -0.55, 0]} fontSize={0.18} color="#88ffaa" anchorX="center">
        {`M∞ = ${flowParams.mach.toFixed(2)}`}
      </Text>
      <Text position={[0, -0.85, 0]} fontSize={0.12} color="#668877" anchorX="center">
        flow direction
      </Text>
    </group>
  );
}

function MachCone() {
  const { flowParams } = useSimStore();
  const flowQuat = useMemo(
    () => getFlowQuaternion(flowParams.angleOfAttack, flowParams.sideslip),
    [flowParams.angleOfAttack, flowParams.sideslip],
  );

  if (flowParams.mach <= 1) return null;

  const halfAngle = Math.asin(1 / flowParams.mach);
  const len = 2.5;
  const radius = Math.tan(halfAngle) * len;

  return (
    <group position={[INLET_X - 0.5, 0, 0]} quaternion={flowQuat}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[radius, len, 32, 1, true]} />
        <meshBasicMaterial color="#4488ff" wireframe transparent opacity={0.35} />
      </mesh>
      <Html position={[0, radius + 0.35, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="scene-tooltip">
          <strong>Mach cone</strong>
          <span>
            Half-angle sin⁻¹(1/M). Disturbances inside this cone reach the body; outside they cannot
            (supersonic free stream).
          </span>
        </div>
      </Html>
    </group>
  );
}

function TunnelSection() {
  return (
    <group>
      <Grid
        args={[12, 8]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#334455"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#556677"
        fadeDistance={20}
        position={[0, -2, 0]}
      />
      <mesh position={[0, -2.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 4]} />
        <meshStandardMaterial color="#1a2233" transparent opacity={0.5} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(12, 4, 4)]} />
        <lineBasicMaterial color="#445566" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}

function SceneContent() {
  const { shapes, selectedShapeId, selectShape } = useSimStore();

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-3, 4, -2]} intensity={0.4} />

      <TunnelSection />
      <FlowDirectionIndicators />
      <MachCone />
      <StreamlineParticles />
      <ShockSurfaces />
      <SlicePlaneView />

      {shapes.map((shape) => (
        <Fragment key={shape.id}>
          <ShapeMesh shape={shape} isSelected={shape.id === selectedShapeId} />
          <BoundaryLayerShell shape={shape} />
        </Fragment>
      ))}

      <mesh visible={false} onClick={() => selectShape(null)} position={[0, 0, 0]}>
        <boxGeometry args={[20, 10, 10]} />
      </mesh>

      <OrbitControls makeDefault maxPolarAngle={Math.PI * 0.85} />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport />
      </GizmoHelper>
    </>
  );
}

export function WindTunnelScene() {
  const regime = useSimStore((s) => detectRegime(s.flowParams.mach));

  return (
    <div className="scene-container">
      <div className="regime-badge">{regime.toUpperCase()}</div>
      <Canvas
        shadows
        camera={{ position: [6, 4, 8], fov: 50, near: 0.1, far: 100 }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0e14');
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
