import type { ReactNode } from 'react';

interface SettingLabelProps {
  label: string;
  tip: string;
  children: ReactNode;
}

export function SettingLabel({ label, tip, children }: SettingLabelProps) {
  return (
    <label className="setting-label">
      <span className="label-row">
        <span>{label}</span>
        <span className="tip-trigger" data-tip={tip} aria-label={tip}>
          ?
        </span>
      </span>
      {children}
    </label>
  );
}
