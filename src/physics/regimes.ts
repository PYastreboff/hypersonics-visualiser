import type { FlowRegime } from '@/types';

export function detectRegime(mach: number): FlowRegime {
  if (mach < 0.7) return 'subsonic';
  if (mach < 1.3) return 'transonic';
  if (mach < 5) return 'supersonic';
  return 'hypersonic';
}

export function regimeLabel(regime: FlowRegime): string {
  switch (regime) {
    case 'subsonic':
      return 'Subsonic';
    case 'transonic':
      return 'Transonic';
    case 'supersonic':
      return 'Supersonic';
    case 'hypersonic':
      return 'Hypersonic';
  }
}

export function criticalMach(thicknessRatio: number): number {
  return Math.max(0.5, 1 - 0.5 * thicknessRatio);
}
