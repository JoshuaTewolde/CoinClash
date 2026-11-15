/** Join a friend's open challenge with the 6-digit code from their invite screen (#4). */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorText, ScreenHead } from '../design/components';
import { api } from '../lib/api';

export function JoinCode() {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (digits.length !== 6) return setError('Enter all 6 digits');
    setBusy(true);
    setError('');
    try {
      const { inviteCode } = await api.joinCode(digits);
      navigate(`/i/${inviteCode}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No challenge with that code');
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <ScreenHead title="Join with code" back="/" />
      <Card raised>
        <form className="stack" onSubmit={(e) => void join(e)} noValidate>
          <label className="field">
            6-digit code from your friend’s screen
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              value={digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary" size="lg" block busy={busy}>
            Find challenge
          </Button>
        </form>
      </Card>
    </main>
  );
}
