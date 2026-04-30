# Signal — Product Spec

## Problem Statement

Operators, founders, and people working in tech follow dozens of high-signal accounts on X (VCs, AI builders, researchers, designers), but the volume and noise on the platform make it impossible to keep up without spending hours scrolling. The result is constant low-grade FOMO and the worse-than-FOMO experience of *missing* the actual signal — a funding round, a launch, a meaningful take — buried under engagement bait.

Signal is a daily web page and email that ingests tweets from a curated list of accounts, uses a multi-agent pipeline to filter and synthesize the day's actual signal, and presents it in the editorial voice of Axios smart brevity, the thoughtfulness of a16z and YC writing, and the engaging flavor of TBPN. It is built for someone who wants to stay current on AI/tech without living on X.

## Target User

**v1:** Just the builder (myself). A single curated X List of ~30 accounts in AI, tech, and VC.

**Future:** Anyone in tech who follows specific tech circles on X — VCs, AI researchers, AI builders, designers, indie hackers. Each user provides their own X List as input.

## What Success Looks Like

- A daily digest is generated automatically every morning by 7am Pacific.
- The digest synthesizes the previous 24 hours of tweets from the source list into 2–4 themes.
- Each theme has a 1–2 sentence summary in the target editorial voice, plus 2–3 supporting tweets quoted with author attribution and link.
- The web page at `/today` is the primary surface; the email is a secondary delivery channel.
- A public "Editorial Room" view shows how the digest was made — the multi-agent pipeline, the filtered-out tweets, and the eval score.
- The eval harness scores each digest on a fixed rubric and the score is visible.

## User Stories

1. As the user, I open the web app each morning and see today's digest at `/today`, with 2–4 themes, each backed by quoted tweets.
2. As the user, I receive an email every morning at 7am Pacific containing the same digest in a styled email-friendly format (quotes + author + link, no embedded tweet widgets).
3. As the user, I click "How was this made?" on the web page and see the multi-agent pipeline that produced today's digest, including which tweets were filtered out and why.
4. As the user, I can scroll through an archive of past digests at `/archive` to skim what I missed earlier in the week.
5. As the user, I can see today's eval score (e.g. "8.2 / 10") and click into the rubric to see the breakdown.

## Non-Goals (v1)

- iMessage / SMS delivery. Deferred to v3+.
- User-provided X Lists or bookmarks. Deferred to v2.
- Authentication or user accounts. v1 is a single-user app for the builder.
- Mobile app. Web is responsive but no native iOS/Android.
- Real-time / live updates. Once-daily generation is sufficient.
- Embedded tweet widgets in email (most email clients strip them).
- Monetization, payments, or paywall.

## Editorial Voice

The writing should feel like a tight cross between three reference points:

- **Axios smart brevity:** front-loaded "why it matters," bullet-friendly, no warm-up paragraphs, ruthless about cutting words.
- **a16z / YC essay thoughtfulness:** shows it understands *why* the news matters in context, not just *that* it happened.
- **TBPN flavor:** terminally online but tasteful — covers the actual current thing in tech circles, knows the pseudonymous posters (e.g. @roon, @signulll) without being cringe about it, captures the day's drama or sentiment when relevant.

A theme summary should never be longer than 60 words. Quoted tweets are presented in a styled blockquote with `@handle` and a link to the original tweet.

## Architecture (High-Level)

The pipeline runs once daily, triggered by a Vercel cron job. It is a multi-agent system where each agent is a focused LLM call with a specific job:

```

Cron (7am Pacific)
↓
Apify Twitter List Scraper
↓ (raw tweets, ~600/day)
Scout Agent (Haiku 4.5)
↓ filters for signal — keeps ~20–40 tweets
Theme Agent (Sonnet 4.6)
↓ clusters into 2–4 themes
Writer Agent (Sonnet 4.6, extended thinking)
↓ drafts each theme in editorial voice
Editor Agent (Opus 4.7)
↓ tightens, kills clichés, applies brevity rules
Eval Agent (Haiku 4.5)
↓ scores draft against rubric, may loop back to Editor
Final Digest
├→ Postgres (Supabase) — stored for archive
├→ Web page at /today
└→ Email via Resend

```

Each agent's prompt, input, and output is logged to the database so the Editorial Room view can replay the full pipeline.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes, Vercel cron for scheduling
- **Database:** Supabase (Postgres) — stores tweets, themes, digests, eval results, and pipeline logs
- **AI:** Anthropic SDK directly. Claude Haiku 4.5 for filtering and eval, Sonnet 4.6 for theme + writing, Opus 4.7 for final editing. Prompt caching enabled on system prompts.
- **Scraping:** Apify Twitter List Scraper actor
- **Email:** Resend (transactional email, generous free tier)
- **Evals:** Inspect AI framework, run via GitHub Actions on a nightly schedule against a holdout set of past digests
- **Hosting:** Vercel (web app + cron), Supabase (database)
- **Observability:** Console logs in v1; Langfuse or Braintrust later if needed

## The Eval Rubric

Every generated digest is scored 1–10 on five dimensions by an LLM-as-judge using Haiku 4.5:

1. **Signal vs. noise** — does it surface the day's real news/launches/takes, not engagement bait?
2. **Voice** — does it read like Axios + a16z + TBPN, or does it read like generic AI slop?
3. **Brevity** — is each theme tight, with no warm-up filler?
4. **Citation honesty** — do the quoted tweets actually support the theme summary?
5. **Coverage** — across the 24-hour window, were the major themes captured? (Compared against a small hand-labeled holdout set.)

If the score is below 6 on any dimension, the Editor Agent receives the rubric feedback and re-drafts that section once.

## Wow Factor: The Editorial Room

A public page at `/editorial-room/[date]` that shows the full pipeline replay for any past digest:

- The 600 raw tweets that were ingested
- Which 580 were filtered out by Scout, with the per-tweet reasoning
- The 20–40 tweets that survived
- Each theme cluster, with the Theme Agent's reasoning
- The Writer Agent's first draft of each section
- The Editor Agent's revisions, with diff
- The Eval Agent's score breakdown and any feedback loops
- Total tokens used, total cost, total wall-clock time

This view is the demo moment. It transforms a simple-looking newsletter into a transparent multi-agent system, and shows that the builder understands evals, observability, and agent design.

## Milestones

**Milestone 1 — Working Pipeline (Weeks 1–2)**
- Apify scraper pulls tweets from a list, stores in Supabase
- Scout → Theme → Writer agents run end-to-end
- Output renders as plain text in the terminal
- Goal: prove the agentic loop works

**Milestone 2 — Web App + Email (Weeks 2–3)**
- Next.js app with `/today` page
- Daily Resend email triggered by cron
- Styled UI in shadcn/ui
- Archive page at `/archive`

**Milestone 3 — Editor + Evals (Week 3)**
- Add Editor Agent to the pipeline
- Build Inspect-based eval harness
- Hand-label a holdout set of 30 past digests
- Wire eval results into the database

**Milestone 4 — Editorial Room + Polish (Week 4)**
- `/editorial-room/[date]` view
- Public archive
- README with demo GIF, architecture diagram, eval results
- Loom walkthrough video
- Deploy to a custom subdomain (e.g. `signal.yoursite.com`)

## Future Ideas (Not v1)

- User-provided X List as input (v2)
- Twitter bookmarks ingestion (v2)
- iMessage delivery via Spectrum or a Mac relay (v3+)
- Multi-circle support (AI builders, VC, designers, etc., as separate digests)
- Personalization: "more like this," "less like this" learning loop
- Voice-generated audio version (TBPN-style mini-podcast) via ElevenLabs

## Known Risks and Tradeoffs

- **X TOS gray area.** Scraping X via Apify is a known compliance gray area. For a personal-use side project this is an accepted risk; the README will be honest about it. If the project is opened to other users in v2, we re-evaluate.
- **Apify cost variance.** Costs scale with tweet volume. v1 is bounded to one curated list (~600 tweets/day) at ~$5–6/month. We monitor and add a hard ceiling.
- **Multi-agent latency.** The full pipeline may take 60–120 seconds per run. Acceptable for a once-daily cron job, but a future "regenerate now" button would need a streaming UX.
- **Eval ground truth is small.** A 30-digest holdout is enough for directional signal, not statistical significance. Honest about this in the README.
- **Supabase project setup quirks.** Project was created with "automatically expose new tables" off and "automatic RLS" on. The initial migration required manually disabling the `ensure_rls` event trigger (`DROP EVENT TRIGGER ensure_rls`) and granting `service_role` access to the public schema. Future migrations inherit the default privilege grants set in the initial migration. This is a one-time fix, recorded so future me / anyone cloning the repo doesn't repeat the debugging.
