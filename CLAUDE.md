# Signal — Claude Code Instructions

## What this project is

Signal is a daily AI digest of curated tech/AI accounts on X. A multi-agent pipeline scrapes tweets, filters for signal, clusters into themes, and writes a daily brief in a specific editorial voice. Web app at `/today`, daily email via Resend, transparency view at `/editorial-room/[date]`.

The full product spec lives in `docs/spec.md`. Read it before making product decisions.

## Tech stack (fixed — do not propose alternatives without asking)

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Postgres) for database
- Anthropic SDK directly (not LangChain, not Vercel AI SDK for the agents — only for streaming UI)
- Apify for scraping (Twitter List Scraper actor)
- Resend for email
- Vercel for hosting and cron
- Inspect AI (Python) for evals — lives in `evals/` directory, separate toolchain

## File structure conventions

- `app/` — Next.js App Router pages and API routes
- `lib/agents/` — agent implementations (one file per agent: scout.ts, theme.ts, writer.ts, editor.ts, eval.ts)
- `lib/scrapers/` — Apify integration
- `lib/db/` — Supabase client and queries
- `lib/email/` — Resend templates and senders
- `prompts/` — agent system prompts as standalone .md files (so they can be edited without touching code)
- `evals/` — Python eval harness (Inspect AI)
- `docs/` — spec, architecture decisions, runbooks
- `.claude/` — slash commands, sub-agent definitions, settings

## Model routing

- **Haiku 4.5** (`claude-haiku-4-5-20251001`) — Scout agent (per-tweet filtering), Eval agent (LLM-as-judge scoring), any cheap classification
- **Sonnet 4.6** (`claude-sonnet-4-6`) — Theme agent (clustering), Writer agent (drafting in editorial voice), default for general work
- **Opus 4.7** (`claude-opus-4-7`) — Editor agent only (final pass, applies brevity rules)

Always enable prompt caching on system prompts longer than 1024 tokens. Use the Anthropic SDK's `cache_control: { type: "ephemeral" }` parameter.

## Non-negotiable rules

- Never commit `.env` or `.env.local`. They are in `.gitignore`. If you ever see one being added in a `git add`, stop and tell me.
- Never run `git push --force` or `git push -f` on the main branch.
- Never run destructive shell commands without confirming first: `rm -rf`, `DROP TABLE`, anything that wipes the database.
- API keys go in `.env.local` for development. There is a committed `.env.example` showing what variables are needed (without values).
- All agent prompts live in `prompts/<agent-name>.md` as Markdown files. Do not inline long prompt strings in TypeScript code.
- All database changes go through migration files in `supabase/migrations/`. Never edit production tables directly.

## How to verify work

When you finish a task, do not say "done" until one of these is true:

- For TypeScript code: `pnpm typecheck` passes (no type errors)
- For UI changes: take a screenshot via the Playwright MCP and confirm it looks right
- For agent changes: run the agent end-to-end on a test input and show me the output
- For database changes: run the migration and show the schema

If a verification step is impossible (e.g. no test data yet), say so explicitly.

## Editorial voice (for any user-facing text)

Signal's voice = Axios smart brevity + a16z thoughtfulness + TBPN flavor.

- Front-load the "why it matters." No warm-up paragraphs.
- A theme summary is never longer than 60 words.
- No clichés ("game-changer," "in today's fast-paced world," "navigating the landscape").
- Quotes use `@handle` and link to the original tweet.
- Don't fake authority. If a tweet's claim is rumored or unverified, say so.

## Workflow preferences

- Use plan mode (`/plan` or Shift+Tab twice) for any task touching more than 2 files.
- After completing a meaningful unit of work, suggest a commit with a clear message. Do not commit automatically — ask first.
- Prefer small, focused commits over large sweeping ones.
- When something requires a decision I should make (architecture, naming, tradeoff), ask. Do not silently pick.