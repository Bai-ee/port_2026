import { Minus, Plus } from 'lucide-react';
import { XCE_COLORS, XCE_RADII, XCE_TYPE } from '../xce-tokens';
import IconButton from './IconButton';

// Labelled "− value +" control. Controlled: parent owns `value`; clamped to min/max.
export default function Stepper({ id, label, value, onChange, min = 0, max = 99, step = 1, disabled }) {
  const set = (n) => onChange && onChange(Math.min(max, Math.max(min, n)));
  return (
    <div id={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ ...XCE_TYPE.label, fontFamily: XCE_TYPE.mono, color: XCE_COLORS.inkSoft }}>{label}</span>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <IconButton label={`Decrease ${label}`} icon={<Minus size={16} />} size={36} disabled={disabled || value <= min} onClick={() => set(value - step)} />
        <span
          aria-live="polite"
          style={{
            minWidth: 52,
            height: 36,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${XCE_COLORS.border}`,
            borderRadius: XCE_RADII.md,
            fontSize: 15,
            color: XCE_COLORS.ink,
          }}
        >
          {value}
        </span>
        <IconButton label={`Increase ${label}`} icon={<Plus size={16} />} size={36} disabled={disabled || value >= max} onClick={() => set(value + step)} />
      </div>
    </div>
  );
}
