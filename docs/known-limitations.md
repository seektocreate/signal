## Theme agent: discourse-blind

Theme operates on isolated tweets within our 72-hour scrape window. It cannot see when an external link or topic is generating broader discussion across the X ecosystem because the scraper doesn't follow conversation graphs (replies, quote-tweets, screenshots referencing the same source).

Symptom: when one author posts 3-4 tweets about a single source (e.g. Dwarkesh on a single podcast episode), Theme correctly declines to manufacture a theme around author prolificness, but misses that the *episode itself* is the day's discourse story.

Fix lives in the scrape layer, not the prompt: add reply/quote-tweet density signals to the input data, and Theme will be able to identify discourse storylines correctly.

## Failed-run costs not rolled into digests.total_cost_cents

`agent_runs` failure rows are not rolled into `digests.total_cost_cents`. Mirrors Theme; affects any digest with retried/failed agent calls. Reconcile via `sum(cost_cents) from agent_runs` for true cost.

## Eval: dimension contamination observed

The prompt names "letting one dimension contaminate another" as a failure mode, but Eval committed it anyway on 2026-04-30 run_index=1: the Dwarkesh-podcast-series omission surfaced as an issue under both `signal_vs_noise` and `coverage`. The omission belongs in coverage (what the published themes did or didn't include vs. the kept set); signal_vs_noise should only flag whether the themes that *did* run are substantive, and all four were. Fix is a calibration question, not a clear prompt patch — with n=2 runs against a single digest, broader data is needed before re-tuning. Revisit once more digests have been scored.