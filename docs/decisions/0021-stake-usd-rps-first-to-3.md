# 0021: Dollar hint on the stake picker, RPS first to 3, final board hold

- **Date:** 2026-11-15
- **Status:** Accepted (owner feedback). Amends ADR 0009 (dollars only on mainnet) and ADR 0014.

## Decisions

1. **Stake picker:** under the stake it says just **"sats"** on the left and **"≈ $1.94"** on
   the right. The 100 to 100,000 limits are no longer shown; out-of-range values are still clamped.
   - The rate is the Breez SDK's `listFiatRates()` USD rate on the server's house wallet, served
     by `GET /api/rate` (cached 5 minutes) and fetched once per page load.
   - It's shown on test networks too, as "what this stake would be worth". This amends ADR 0009
     for the stake picker only; other amounts still show dollars only on mainnet.
   - No rate (mock, or the call fails): the dollar hint is hidden.
2. **Rock Paper Scissors defaults to best of 5, first to 3 round wins** (was best of 3).
   Best of 3 stays as an option. Round cap 15; `maxMatchSeconds` already covered it.
3. **Final board hold:** when a game ends while you're watching, the finished board stays up
   before the result screen, so the last move lands: RPS 3.8 s (the final clash and "You win
   the round!"), Trivia 3 s, others 2 s. Pool has no hold because its result screen replays the
   last shot. Timers and Resign are hidden during the hold.
