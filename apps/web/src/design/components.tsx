/** Sticker Arcade design system (spec §9): Button, Card, Amount, Timer, BoardFrame and friends. */
import { formatAmount, type Network } from '@coinclash/shared';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'accent' | 'teal' | 'plain';

function btnClass(variant: Variant, size: 'md' | 'lg', block: boolean, extra?: string) {
  return [
    'btn',
    variant !== 'plain' && `btn--${variant}`,
    size === 'lg' && 'btn--lg',
    block && 'btn--block',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg';
  block?: boolean;
  busy?: boolean;
}

export function Button({
  variant = 'plain',
  size = 'md',
  block = false,
  busy = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={btnClass(variant, size, block, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'plain',
  size = 'md',
  block = false,
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: 'md' | 'lg'; block?: boolean }) {
  return <Link className={btnClass(variant, size, block, className)} {...rest} />;
}

export function Card({
  tone,
  raised,
  dashed,
  className,
  children,
  as: Tag = 'section',
  ...rest
}: {
  tone?: 'paper' | 'sun' | 'teal';
  raised?: boolean;
  dashed?: boolean;
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  'aria-label'?: string;
}) {
  const cls = [
    'card',
    tone && `card--${tone}`,
    raised && 'card--raised',
    dashed && 'card--dashed',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}

/** Money amount. Bitcoin orange is used for amounts only (spec §9). */
export function Amount({
  sats,
  network,
  rate,
  size = 'md',
  sign,
}: {
  sats: number;
  network: Network;
  rate?: number | null;
  size?: 'sm' | 'md' | 'lg';
  sign?: '+' | '-';
}) {
  const f = formatAmount(sats, network, rate);
  return (
    <span className={`amount amount--${size}`}>
      <span className="amount__sats">
        {sign}
        {f.sats}
      </span>
      {f.fiat && <span className="amount__fiat">({f.fiat})</span>}
    </span>
  );
}

/** Re-renders every `ms` and returns Date.now(). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function formatClock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function Timer({ deadline, label = 'Time left' }: { deadline: number; label?: string }) {
  const now = useNow(500);
  const left = deadline - now;
  return (
    <div className={`timer${left < 15_000 ? ' timer--urgent' : ''}`} role="timer">
      <span className="eyebrow">{label}</span>
      <span className="timer__value">{formatClock(left)}</span>
    </div>
  );
}

export function BoardFrame({ children }: { children: ReactNode }) {
  return <div className="board-frame">{children}</div>;
}

export function Logo({ big }: { big?: boolean }) {
  return (
    <p className={`logo${big ? ' logo--big' : ''}`}>
      Coin<span className="logo__clash">Clash</span>
    </p>
  );
}

export function BackButton({ to }: { to?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="btn btn--icon"
      aria-label="Back"
      onClick={() => (to ? navigate(to) : navigate(-1))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M15 5l-7 7 7 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function ScreenHead({ title, back }: { title: string; back?: string | true }) {
  return (
    <header className="screen__head">
      {back && <BackButton to={back === true ? undefined : back} />}
      <h1>{title}</h1>
    </header>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null;
}

const icons = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12h2M3 9h18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
};

export function BottomNav() {
  const items = [
    { to: '/', label: 'Home', icon: icons.home },
    { to: '/wallet', label: 'Wallet', icon: icons.wallet },
    { to: '/settings', label: 'Settings', icon: icons.settings },
  ] as const;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {i.icon}
          </svg>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function FlameIcon({ lit }: { lit: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={lit ? 'var(--cc-tomato)' : 'var(--cc-white)'}
      stroke={lit ? 'var(--cc-ink)' : 'var(--cc-ink-soft)'}
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z" />
    </svg>
  );
}

export function LockIcon({ open }: { open?: boolean }) {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d={open ? 'M8 10V7a4 4 0 0 1 7.5-2' : 'M8 10V7a4 4 0 0 1 8 0v3'} />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function CoinBurst() {
  const coins = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const r = 110 + (i % 3) * 30;
    return {
      dx: `${Math.round(Math.cos(angle) * r)}px`,
      dy: `${Math.round(Math.sin(angle) * r)}px`,
    };
  });
  return (
    <>
      {coins.map((c, i) => (
        <span
          key={i}
          className="coin"
          aria-hidden="true"
          style={{
            ['--dx' as string]: c.dx,
            ['--dy' as string]: c.dy,
            animationDelay: `${i * 25}ms`,
          }}
        />
      ))}
    </>
  );
}
