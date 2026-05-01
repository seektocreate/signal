## Diagnose against source before documenting bugs

A state inconsistency in production looks the same whether the cause is a code bug or an operator action. Documenting "this is a bug" before walking the source and the audit trail can leave a wrong note in the repo, and any future reader who trusts the doc will chase a bug that doesn't exist.

Real instance: digest 2026-04-30 was at `status='filtering'` after a clean Theme success. Easy to read as "Theme's success path didn't advance status" — but `scripts/theme.ts`'s success and failure paths both update by date with no status guard, and the `agent_runs` trail showed no script touched the digest after Theme finished. The real cause was an out-of-band manual edit during prompt-iteration testing.

Before adding a "this is broken" entry to `known-limitations.md`, walk the source and confirm the code path that produces the observed state. If no code path explains it, name the cause out-of-band rather than as a bug. "I don't know what caused this" is fine; "X is broken" when it isn't is worse than nothing.
