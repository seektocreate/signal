## Diagnose against source before documenting bugs

A state inconsistency in production looks the same whether the cause is a code bug or an operator action. Documenting "this is a bug" before walking the source and the audit trail can leave a wrong note in the repo, and any future reader who trusts the doc will chase a bug that doesn't exist.

Real instance: digest 2026-04-30 was at `status='filtering'` after a clean Theme success. Easy to read as "Theme's success path didn't advance status" — but `scripts/theme.ts`'s success and failure paths both update by date with no status guard, and the `agent_runs` trail showed no script touched the digest after Theme finished. The real cause was an out-of-band manual edit during prompt-iteration testing.

Before adding a "this is broken" entry to `known-limitations.md`, walk the source and confirm the code path that produces the observed state. If no code path explains it, name the cause out-of-band rather than as a bug. "I don't know what caused this" is fine; "X is broken" when it isn't is worse than nothing.

## SDK source and current docs are the source of truth, not the task spec

When a task specifies an SDK call shape, the SDK's actual TypeScript types and the current Anthropic docs are authoritative. A confidently-worded task spec is not.

Real instance: Editor's task spec specified `output_config: { effort: "high", display: "summarized" }` together on Opus 4.7. SDK 0.92's `OutputConfig` type has `effort` and `format` only — `display` lives on `ThinkingConfigAdaptive` instead, and the current Anthropic adaptive-thinking docs agree. The correct call shape is `thinking: { type: "adaptive", display: "summarized" }`, `output_config: { effort: "high" }`. Following the spec verbatim would have produced either a typecheck failure or, worse, a 400 at runtime on a billed call.

The discipline: when an SDK rejects a spec's shape at typecheck, halt and verify against both the SDK source and current docs before adjusting. Don't reach for `as any` to make the spec compile. The right correction is the one the runtime will accept, not the one the spec wrote.
