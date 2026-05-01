# Signal: agent script conventions

These conventions apply to all per-stage agent scripts (`scripts/scout.ts`,
`scripts/theme.ts`, and the future `writer.ts`, `editor.ts`, `eval.ts`).
When adding a new agent, mirror these patterns — they were arrived at by
hitting the failure modes they prevent.

## Active-digest status filter

The query that finds "the digest this script should operate on" must allow
all three of: the upstream-completion state, this stage's own in-progress
state, and `'failed'`.

For Theme, that's:

    .in("status", ["filtering", "theming", "failed"])

- Upstream state (`'filtering'` for Theme): normal flow, the previous
  agent just finished.
- Own state (`'theming'`): the script crashed mid-run last time, we're
  resuming.
- `'failed'`: the previous run failed cleanly, we're retrying.

Including `'failed'` matters for cron orchestration: a stateless
orchestrator shouldn't need to know whether to pass a retry flag.
Re-invoking the script should just work.

Never include `'complete'` — that would re-process finished digests and
clobber downstream agents' work.

## Status transitions: set early, fail loud

Set the digest to this stage's in-progress status BEFORE the API call,
not after success. A crashed run leaves the digest visibly stuck in
the in-progress state rather than appearing to still belong to the
previous stage. This is the difference between "I can see Theme is
broken" and "Why has this digest been in `filtering` for an hour?"

## agent_runs is always written

Every run writes one row to `agent_runs`, success or failure. The `error`
column is null on success, populated on failure. This preserves the full
audit trail for prompt iteration — you can see what the model returned
on a failed run, not just that it failed.

The implementation pattern: a single outer try/catch around the main
flow, with the catch writing the agent_runs row before re-throwing.

## Re-runs delete prior outputs for the same digest

If the script's outputs already exist for the active digest (e.g. Theme
finds existing `themes` rows), delete them before re-running. This makes
prompt iteration painless — change the prompt, re-run, see new output.
agent_runs is never deleted, so iteration history is preserved.

Confirm the FK cascade behavior of dependent tables before relying on a
single delete to clear children.

## Integer IDs for model-facing references

When a script asks the model to reference items from a list it received
as input (tweet IDs, theme IDs, citation positions, etc.), give the
model 1-indexed sequential integers, not UUIDs.

LLMs hallucinate UUIDs. They don't tokenize semantically and the model
will sometimes invent ID-shaped strings rather than copy the real ones.
Sequential integers tokenize cleanly and the model copies them
reliably.

The pattern: build a `Map<number, uuid>` translation layer in the
script. Send integers to the model, translate back to UUIDs at the
database boundary.

## Cost ceiling per run

Every script declares a `COST_CEILING_USD` constant and aborts if a
single run would exceed it. Theme's is $1.00. Calibrate per stage.

## Model strings: alias only, no snapshot suffix

Use the alias form (`claude-sonnet-4-6`, `claude-haiku-4-5`) unless a
specific snapshot is required for reproducibility. The snapshot dates
on legacy models (e.g. `-20250929`) do not apply to current models
and using them produces a 404.