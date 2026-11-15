# Design decisions (ADRs)

Each file records one decision: the context, what we chose, the alternatives, and the trade-offs
we accepted. When a decision changes, add a new record that supersedes the old one rather than
silently editing history. `docs/SPEC.md` is the source of truth. Where a record changes the spec,
the spec carries an amendment note that points here.

| #    | Decision                                                                                      | Status             |
| ---- | --------------------------------------------------------------------------------------------- | ------------------ |
| 0001 | [Monorepo, tooling and repo conventions](0001-monorepo-and-tooling.md)                        | Accepted           |
| 0002 | [Secure mode = HTLC "oracle" escrow; no custody, no Trusted mode](0002-htlc-oracle-escrow.md) | Accepted           |
| 0003 | [Chrome-only target, two-button passkey flow](0003-chrome-only-passkeys.md)                   | Accepted           |
| 0004 | [Hosting: coinclash.vip on Vultr, MongoDB Atlas](0004-hosting-and-database.md)                | Accepted           |
| 0005 | [One Breez API key for now](0005-breez-api-keys.md)                                           | Accepted (revisit) |
| 0006 | [Game plug-in interface details](0006-game-plugin-interface.md)                               | Accepted           |

Template: **Context** (why we had to decide) → **Decision** → **Alternatives considered** →
**Consequences / trade-offs** → **Open questions**.
