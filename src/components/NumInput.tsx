import { useEffect, useState } from 'react';

export function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  className = 'num-input',
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [value]);

  const display = draft ?? String(value);

  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  const commit = (raw: string) => {
    setDraft(null);
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    onChange(clamp(parsed));
  };

  return (
    <input
      type="number"
      value={display}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '' || raw === '-' || raw.endsWith('.') || raw.endsWith('e')) return;
        const parsed = parseFloat(raw);
        if (!Number.isNaN(parsed)) onChange(clamp(parsed));
      }}
      onBlur={() => {
        if (draft !== null) commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft !== null) {
          commit(draft);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
