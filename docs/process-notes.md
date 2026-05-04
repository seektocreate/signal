## Diagnose against source before documenting bugs

A state inconsistency in production looks the same whether the cause is a code bug or an operator action. Documenting "this is a bug" before walking the source and the audit trail can leave a wrong note in the repo, and any future reader who trusts the doc will chase a bug that doesn't exist.

Real instance: digest 2026-04-30 was at `status='filtering'` after a clean Theme success. Easy to read as "Theme's success path didn't advance status" — but `scripts/theme.ts`'s success and failure paths both update by date with no status guard, and the `agent_runs` trail showed no script touched the digest after Theme finished. The real cause was an out-of-band manual edit during prompt-iteration testing.

Before adding a "this is broken" entry to `known-limitations.md`, walk the source and confirm the code path that produces the observed state. If no code path explains it, name the cause out-of-band rather than as a bug. "I don't know what caused this" is fine; "X is broken" when it isn't is worse than nothing.

## SDK source and current docs are the source of truth, not the task spec

When a task specifies an SDK call shape, the SDK's actual TypeScript types and the current Anthropic docs are authoritative. A confidently-worded task spec is not.

Real instance: Editor's task spec specified `output_config: { effort: "high", display: "summarized" }` together on Opus 4.7. SDK 0.92's `OutputConfig` type has `effort` and `format` only — `display` lives on `ThinkingConfigAdaptive` instead, and the current Anthropic adaptive-thinking docs agree. The correct call shape is `thinking: { type: "adaptive", display: "summarized" }`, `output_config: { effort: "high" }`. Following the spec verbatim would have produced either a typecheck failure or, worse, a 400 at runtime on a billed call.

The discipline: when an SDK rejects a spec's shape at typecheck, halt and verify against both the SDK source and current docs before adjusting. Don't reach for `as any` to make the spec compile. The right correction is the one the runtime will accept, not the one the spec wrote.

## Re-run hygiene patterns must be coherent: increment-run_index requires status filter to include post-success state

Re-run hygiene has two coherent shapes — delete-before-rerun (Theme/Editor) and increment-run_index (Eval) — and each implies a different status filter. The delete-before-rerun pattern works because the digest is still in the agent's pre-success status when re-invoked; the increment-run_index pattern preserves prior rows by design, so the digest will already be in the post-success status on re-invocation. Picking one pattern's writer-side and the other pattern's filter-side leaves a script that runs successfully once and refuses to re-run without manual SQL.

Real instance: Eval V1 shipped on 2026-04-30 with `ALLOWED_START_STATUSES = ['evaluating', 'failed']` and an increment-run_index design. The first run advanced the digest to `'complete'` and produced run_index=0 scores. The second invocation — intended to compare a prompt patch — failed with "no digest in status evaluating/failed." Manual `UPDATE digests SET status='evaluating'` unblocked it and produced run_index=1, but the script's two design choices were contradicting each other: increment-run_index intentionally supports re-running, while the status filter blocked it.

The discipline: delete-before-rerun + status-locked-to-pre-success and increment-run_index + status-allows-post-success are coherent wholes, not pickable pieces. When picking re-run hygiene for a new agent, pick one whole pattern. If history-preservation is the goal, the status filter must include the post-success state; otherwise the design pretends to support re-runs while quietly requiring operator intervention.
