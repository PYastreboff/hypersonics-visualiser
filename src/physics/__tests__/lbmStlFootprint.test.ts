import { describe, expect, it } from 'vitest';
import { stlBufferToFootprint } from '@/physics/lbmStlFootprint';
import { buildObstacleMask, lbmInputToSpec } from '@/physics/lbmObstacles';

const TRIANGLE_STL = `solid test
facet normal 0 0 1
  outer loop
    vertex -5 -5 0
    vertex 5 -5 0
    vertex 0 5 0
  endloop
endfacet
endsolid
`;

describe('lbmStlFootprint', () => {
  it('rasterises a simple STL triangle into a stencil', () => {
    const buffer = new TextEncoder().encode(TRIANGLE_STL).buffer;
    const { stencilX, stencilY } = stlBufferToFootprint(buffer, 20);

    expect(stencilX.length).toBeGreaterThan(10);
    expect(stencilX.length).toBe(stencilY.length);
  });

  it('stamps custom stencil obstacles onto the grid', () => {
    const obstacle = buildObstacleMask(60, 40, [
      lbmInputToSpec({
        id: 'custom-1',
        type: 'custom',
        cx: 30,
        cy: 20,
        aoa: 0,
        stencilX: [-2, -1, 0, 1, 2],
        stencilY: [0, 0, 0, 0, 0],
      }),
    ]);

    let filled = 0;
    for (let i = 0; i < obstacle.length; i++) filled += obstacle[i];
    expect(filled).toBe(5);
  });
});
