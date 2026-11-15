/**
 * Network badge + picker (ADR 0010). Tapping the badge opens a menu: Test sats / Real money.
 * Only networks the server lists in `/api/config` can be picked; for now Real money is
 * "Coming soon".
 */
import type { Network } from '@coinclash/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';

export interface NetworkOption {
  readonly key: 'test' | 'real';
  readonly label: string;
  readonly network: Network | null;
}

/** Map the server's selectable networks onto the two player-facing choices. */
export function networkOptions(networks: readonly Network[]): NetworkOption[] {
  return [
    { key: 'test', label: 'Test sats', network: networks.find((n) => n !== 'mainnet') ?? null },
    { key: 'real', label: 'Real money', network: networks.includes('mainnet') ? 'mainnet' : null },
  ];
}

export function isRealMoney(network: Network): boolean {
  return network === 'mainnet';
}

/** Radio list shared by the badge menu and Settings. */
export function NetworkChoices({ onPicked }: { onPicked?: () => void }) {
  const { config, network } = useSnapshot();
  const store = useStoreApi();
  const options = networkOptions(config?.networks ?? []);
  return (
    <>
      {options.map((o) => {
        const checked = o.network !== null && o.network === network;
        return (
          <button
            key={o.key}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            className="menu__item"
            disabled={o.network === null}
            onClick={() => {
              if (o.network) store.setNetwork(o.network);
              onPicked?.();
            }}
          >
            <span
              className="menu__dot"
              style={{ background: o.key === 'test' ? 'var(--cc-teal)' : 'var(--cc-tomato)' }}
            />
            {o.label}
            {o.network === null && <span className="menu__note">Coming soon</span>}
            {checked && <span className="menu__note">Selected</span>}
          </button>
        );
      })}
    </>
  );
}

export function NetworkPicker() {
  const { network } = useSnapshot();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const real = isRealMoney(network);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="netpick" ref={ref}>
      <button
        type="button"
        className={`badge ${real ? 'badge--real' : 'badge--test'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        {real ? 'REAL MONEY' : 'TEST SATS'}
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu" id={menuId} aria-label="Money mode">
          <NetworkChoices onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
