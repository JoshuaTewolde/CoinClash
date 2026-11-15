import { formatAmount } from '@coinclash/shared';
import './App.css';

const swatches = [
  { name: 'Tomato', varName: '--cc-tomato' },
  { name: 'Sunflower', varName: '--cc-sunflower' },
  { name: 'Teal', varName: '--cc-teal' },
  { name: 'Ink', varName: '--cc-ink' },
  { name: 'Paper', varName: '--cc-paper' },
  { name: 'Money', varName: '--cc-money' },
] as const;

export function App() {
  const pot = formatAmount(10_000, 'regtest');
  return (
    <main className="preview">
      <header className="preview__header">
        <h1>
          Coin<span className="preview__clash">Clash</span>
        </h1>
        <p>Friends-only games for sats. Design tokens preview; the app lands in Phase 4.</p>
      </header>

      <section className="preview__swatches" aria-label="Palette">
        {swatches.map((s) => (
          <div key={s.name} className="swatch">
            <div className="swatch__chip" style={{ background: `var(${s.varName})` }} />
            <span>{s.name}</span>
          </div>
        ))}
      </section>

      <section className="preview__card">
        <h2>Pot</h2>
        <p className="money">{pot.sats}</p>
        <button type="button" className="press-button">
          New challenge
        </button>
      </section>
    </main>
  );
}
