import * as THREE from 'three';

export function getFlowDirection(aoaDeg: number, sideslipDeg: number): THREE.Vector3 {
  const aoa = (aoaDeg * Math.PI) / 180;
  const beta = (sideslipDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(aoa) * Math.cos(beta),
    Math.sin(aoa),
    Math.sin(beta) * Math.cos(aoa),
  ).normalize();
}

export function getFlowQuaternion(aoaDeg: number, sideslipDeg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(1, 0, 0),
    getFlowDirection(aoaDeg, sideslipDeg),
  );
}
