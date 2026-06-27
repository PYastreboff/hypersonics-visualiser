import type { ShapeDefinition, ShapeKind } from '@/types';

function sphereArea(r: number, s: [number, number, number]) {
  const radius = r * Math.max(...s);
  return Math.PI * radius * radius;
}

export const SHAPE_DEFINITIONS: Record<ShapeKind, ShapeDefinition> = {
  sphere: {
    kind: 'sphere',
    label: 'Sphere',
    defaultParams: { radius: 0.5 },
    referenceArea: (p, s) => sphereArea(p.radius ?? 0.5, s),
    lengthScale: (p, s) => (p.radius ?? 0.5) * 2 * Math.max(...s),
    wettedArea: (p, s) => 4 * sphereArea(p.radius ?? 0.5, s),
    isBlunt: true,
  },
  cone: {
    kind: 'cone',
    label: 'Cone',
    defaultParams: { radius: 0.4, length: 2, halfAngle: 15 },
    referenceArea: (p, s) => sphereArea(p.radius ?? 0.4, s),
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => {
      const r = (p.radius ?? 0.4) * Math.max(s[1], s[2]);
      const l = (p.length ?? 2) * s[0];
      const slant = Math.sqrt(r * r + l * l);
      return Math.PI * r * slant;
    },
    isBlunt: false,
  },
  wedge: {
    kind: 'wedge',
    label: 'Wedge',
    defaultParams: { length: 2, wedgeAngle: 10 },
    referenceArea: (p, s) => (p.length ?? 2) * s[0] * (p.wedgeAngle ?? 10) * 0.02 * s[1],
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => {
      const l = (p.length ?? 2) * s[0];
      const h = (p.wedgeAngle ?? 10) * 0.02 * s[1];
      const slant = Math.sqrt(l * l + h * h);
      return 2 * slant * l * 0.5;
    },
    isBlunt: false,
  },
  cylinder: {
    kind: 'cylinder',
    label: 'Cylinder',
    defaultParams: { radius: 0.3, length: 2 },
    referenceArea: (p, s) => {
      const r = (p.radius ?? 0.3) * Math.max(s[1], s[2]);
      const l = (p.length ?? 2) * s[0];
      return 2 * r * l;
    },
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => {
      const r = (p.radius ?? 0.3) * Math.max(s[1], s[2]);
      const l = (p.length ?? 2) * s[0];
      return 2 * Math.PI * r * l;
    },
    isBlunt: false,
  },
  flatPlate: {
    kind: 'flatPlate',
    label: 'Flat Plate',
    defaultParams: { length: 2 },
    referenceArea: (p, s) => (p.length ?? 2) * s[0] * 0.5 * s[1],
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => 2 * (p.length ?? 2) * s[0] * 0.5 * s[1],
    isBlunt: false,
  },
  biconic: {
    kind: 'biconic',
    label: 'Biconic',
    defaultParams: { radius: 0.35, length: 2.5, halfAngle: 12, rearRadius: 0.2 },
    referenceArea: (p, s) => sphereArea(p.radius ?? 0.35, s),
    lengthScale: (p, s) => (p.length ?? 2.5) * s[0],
    wettedArea: (p, s) => {
      const r1 = (p.radius ?? 0.35) * Math.max(s[1], s[2]);
      const l = (p.length ?? 2.5) * s[0];
      return Math.PI * r1 * l * 1.2;
    },
    isBlunt: false,
  },
  ogive: {
    kind: 'ogive',
    label: 'Ogive',
    defaultParams: { radius: 0.4, length: 2, noseRadius: 0.15 },
    referenceArea: (p, s) => sphereArea(p.radius ?? 0.4, s),
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => {
      const r = (p.radius ?? 0.4) * Math.max(s[1], s[2]);
      const l = (p.length ?? 2) * s[0];
      return Math.PI * r * l * 1.1;
    },
    isBlunt: false,
  },
  aerofoil: {
    kind: 'aerofoil',
    label: 'Aerofoil',
    defaultParams: { length: 3.5, thickness: 15 },
    referenceArea: (p, s) => (p.length ?? 2) * s[0] * ((p.thickness ?? 12) / 100) * s[1] * 2,
    lengthScale: (p, s) => (p.length ?? 2) * s[0],
    wettedArea: (p, s) => {
      const chord = (p.length ?? 2) * s[0];
      const t = ((p.thickness ?? 12) / 100) * chord;
      return 2.2 * chord * t;
    },
    isBlunt: false,
  },
  custom: {
    kind: 'custom',
    label: 'Custom (STL)',
    defaultParams: { radius: 0.5 },
    referenceArea: (p, s) => sphereArea(p.radius ?? 0.5, s),
    lengthScale: (p, s) => (p.radius ?? 0.5) * 2 * Math.max(...s),
    wettedArea: (p, s) => 4 * sphereArea(p.radius ?? 0.5, s),
    isBlunt: true,
  },
};

export function getShapeDefinition(kind: ShapeKind): ShapeDefinition {
  return SHAPE_DEFINITIONS[kind];
}

export const SHAPE_KINDS = Object.keys(SHAPE_DEFINITIONS) as ShapeKind[];
