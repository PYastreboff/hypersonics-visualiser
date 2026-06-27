import { useRef } from 'react';
import { useSimStore } from '@/store/simStore';
import { SHAPE_DEFINITIONS, SHAPE_KINDS } from '@/shapes/definitions';
import type { ShapeKind } from '@/types';

export function ShapePalette() {
  const { addShape, shapes, selectedShapeId, removeShape, selectShape } = useSimStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSTL = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    useSimStore.getState().addCustomShape(file.name.replace(/\.stl$/i, ''), url);
    e.target.value = '';
  };

  return (
    <div className="panel shape-palette">
      <h3>Shapes</h3>
      <div className="shape-grid">
        {SHAPE_KINDS.filter((k) => k !== 'custom').map((kind) => (
          <button
            key={kind}
            className="shape-btn"
            onClick={() => addShape(kind as ShapeKind)}
            title={SHAPE_DEFINITIONS[kind].label}
          >
            {SHAPE_DEFINITIONS[kind].label}
          </button>
        ))}
      </div>
      <button className="shape-btn import-btn" onClick={() => fileRef.current?.click()}>
        Import STL
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".stl"
        hidden
        onChange={handleSTL}
      />

      {shapes.length > 0 && (
        <div className="shape-list">
          <h4>Placed ({shapes.length})</h4>
          {shapes.map((s) => (
            <div
              key={s.id}
              className={`shape-item ${s.id === selectedShapeId ? 'selected' : ''}`}
              onClick={() => selectShape(s.id)}
            >
              <span>{s.name}</span>
              <button
                className="remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  removeShape(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
