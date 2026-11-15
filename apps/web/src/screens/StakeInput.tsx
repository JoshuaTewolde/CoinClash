/** Typeable stake (ADR 0009 item 3): digits only, separators, clamp on blur, –/+ and presets. */
import { useEffect, useState } from 'react';

export function clampStake(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseStake(text: string): number {
  const digits = text.replace(/[^0-9]/g, '').slice(0, 9);
  return digits ? Number.parseInt(digits, 10) : 0;
}

export function StakeInput({
  value,
  onChange,
  min,
  max,
  presets = [500, 1000, 2000, 5000],
  step = 500,
  label = 'Stake in sats',
}: {
  value: number;
  onChange: (sats: number) => void;
  min: number;
  max: number;
  presets?: readonly number[];
  step?: number;
  label?: string;
}) {
  const [text, setText] = useState(value ? value.toLocaleString('en-US') : '');
  useEffect(() => {
    setText(value ? value.toLocaleString('en-US') : '');
  }, [value]);

  return (
    <div className="stack">
      <div className="stake">
        <button
          type="button"
          className="stake__step"
          aria-label="Less"
          onClick={() => onChange(clampStake(value - step, min, max))}
        >
          –
        </button>
        <input
          className="stake__input"
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={text}
          onChange={(e) => {
            const n = parseStake(e.target.value);
            setText(n ? n.toLocaleString('en-US') : '');
            onChange(n);
          }}
          onBlur={() => onChange(clampStake(value, min, max))}
        />
        <button
          type="button"
          className="stake__step"
          aria-label="More"
          onClick={() => onChange(clampStake(value + step, min, max))}
        >
          +
        </button>
      </div>
      <div className="chips">
        {presets
          .filter((p) => p >= min && p <= max)
          .map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={p === value}
              onClick={() => onChange(p)}
            >
              {p.toLocaleString('en-US')}
            </button>
          ))}
      </div>
      <span className="muted">
        sats · {min.toLocaleString('en-US')} to {max.toLocaleString('en-US')}
      </span>
    </div>
  );
}
