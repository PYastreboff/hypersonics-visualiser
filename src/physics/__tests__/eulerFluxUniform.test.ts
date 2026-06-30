import { describe, expect, it } from 'vitest';
import { fluxX, interfaceFluxX } from '@/physics/eulerFlux';
import { GAMMA } from '@/physics/constants';

describe('interfaceFluxX uniform state', () => {
  const rho = 1.2;
  const u = 100;
  const v = 0;
  const a = 340;
  const p = (rho * a * a) / GAMMA;

  it('roe matches physical flux at uniform flow', () => {
    const physical = fluxX(rho, u, v, p);
    const roe = interfaceFluxX('roe', rho, u, v, p, rho, u, v, p);
    for (let k = 0; k < 4; k++) {
      expect(roe[k]).toBeCloseTo(physical[k], 0);
    }
  });

  it('ausmplus uses HLLC at subsonic interfaces', () => {
    const subsonic = interfaceFluxX('ausmplus', rho, u, v, p, rho, u, v, p);
    const hllc = interfaceFluxX('hllc', rho, u, v, p, rho, u, v, p);
    for (let k = 0; k < 4; k++) {
      expect(subsonic[k]).toBeCloseTo(hllc[k], 4);
    }
  });
});
