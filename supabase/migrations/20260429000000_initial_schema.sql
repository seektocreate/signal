-- Signal — initial schema (Milestone 1: database foundation)
--
-- How this was applied: pasted into the Supabase Dashboard SQL Editor and run
-- manually. The Supabase CLI is intentionally not adopted yet; until it is,
-- migrations in this directory are applied by hand and lib/db/types.ts is
-- maintained in lockstep.
--
-- RLS: intentionally NOT enabled. Signal v1 is single-user and accessed only
-- from server code via the SUPABASE_SECRET_KEY. Revisit when v2 introduces
-- multi-user.
--
-- Storage growth note (v1.5 concern): agent_runs.system_prompt and
-- tweets.raw_json together are projected to grow ~5–6 MB/day at v1 volume
-- (~600 tweets/day, ~6 agent calls/day with cached prompts in the 5–20 KB
-- range). Acceptable for v1. Mitigations to consider later: externalize prompt
-- bodies to object storage with a hash ref, prune raw_json after N days, or
-- move heavy columns to a sibling "archive" table.

begin;

create extension if not exists pgcrypto;

-- digests -------------------------------------------------------------------
-- One row per daily digest. `date` is the natural primary key: it matches the
-- /editorial-room/[date] URL shape and prevents duplicate runs for one day.
create table digests (
  date                 date primary key,
  status               text not null default 'pending',
  started_at           timestamptz,
  completed_at         timestamptz,
  total_input_tokens   integer not null default 0,
  total_output_tokens  integer not null default 0,
  total_cost_cents     integer not null default 0,
  eval_score_overall   numeric(3,1),
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint digests_status_check check (status in (
    'pending','scraping','filtering','theming','writing','editing','evaluating','complete','failed'
  )),
  constraint digests_eval_score_range check (
    eval_score_overall is null or (eval_score_overall >= 0 and eval_score_overall <= 10)
  )
);

-- themes --------------------------------------------------------------------
-- 2–4 themes per digest. Both writer_draft and editor_final are stored so the
-- Editorial Room can render a diff without re-running anything.
create table themes (
  id            uuid primary key default gen_random_uuid(),
  digest_date   date not null references digests(date) on delete cascade,
  position      integer not null,
  title         text not null,
  summary       text not null,
  writer_draft  text,
  editor_final  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint themes_position_range check (position between 1 and 4),
  constraint themes_position_unique unique (digest_date, position)
);

-- agent_runs ----------------------------------------------------------------
-- Generic log of every agent invocation. The Editorial Room replay reads from
-- this. system_prompt is stored inline (not just a path ref) so the exact
-- prompt as sent is recoverable even after prompts/*.md is edited.
--
-- tweets.scout_run_id and eval_scores.agent_run_id reference this table via
-- nullable FKs added below (forward references would otherwise create a
-- cycle).
create table agent_runs (
  id                     uuid primary key default gen_random_uuid(),
  digest_date            date not null references digests(date) on delete cascade,
  theme_id               uuid references themes(id) on delete set null,
  agent                  text not null,
  model                  text not null,
  system_prompt          text not null,
  input_json             jsonb not null,
  output_json            jsonb,
  output_text            text,
  input_tokens           integer not null default 0,
  output_tokens          integer not null default 0,
  cache_read_tokens      integer not null default 0,
  cache_creation_tokens  integer not null default 0,
  cost_cents             numeric(10,4) not null default 0,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  error                  text,
  constraint agent_runs_agent_check check (agent in (
    'scout','theme','writer','editor','eval'
  ))
);

create index agent_runs_digest_agent_idx    on agent_runs (digest_date, agent);
create index agent_runs_digest_started_idx  on agent_runs (digest_date, started_at);

-- tweets --------------------------------------------------------------------
-- Raw tweets pulled by Apify, scoped per-digest for reproducibility. Scout's
-- keep/reject decision lives directly on the row (one decision per tweet per
-- digest by definition; a side table would just add a join).
create table tweets (
  id              uuid primary key default gen_random_uuid(),
  digest_date     date not null references digests(date) on delete cascade,
  x_tweet_id      text not null,
  author_handle   text not null,
  author_name     text,
  text            text not null,
  posted_at       timestamptz not null,
  url             text not null,
  raw_json        jsonb not null,
  scraped_at      timestamptz not null default now(),
  kept            boolean,
  scout_reason    text,
  scout_score     numeric(3,2),
  scout_model     text,
  scout_run_id    uuid references agent_runs(id) on delete set null,
  constraint tweets_x_tweet_id_unique unique (digest_date, x_tweet_id),
  constraint tweets_scout_score_range check (
    scout_score is null or (scout_score >= 0 and scout_score <= 1)
  )
);

create index tweets_digest_idx        on tweets (digest_date);
create index tweets_digest_kept_idx   on tweets (digest_date, kept);
create index tweets_digest_posted_idx on tweets (digest_date, posted_at);

-- theme_citations -----------------------------------------------------------
-- Many-to-many: which tweets back which theme, with display order and role.
create table theme_citations (
  id        uuid primary key default gen_random_uuid(),
  theme_id  uuid not null references themes(id) on delete cascade,
  tweet_id  uuid not null references tweets(id) on delete cascade,
  position  integer not null,
  role      text not null default 'supporting',
  constraint theme_citations_role_check check (role in ('primary','supporting')),
  constraint theme_citations_unique unique (theme_id, tweet_id)
);

create index theme_citations_theme_position_idx on theme_citations (theme_id, position);

-- eval_scores ---------------------------------------------------------------
-- One row per (digest, dimension, run_index). Per-dimension rows (vs. a JSON
-- blob) keep "worst dimension over the past 30 days" trivial to query.
create table eval_scores (
  id            uuid primary key default gen_random_uuid(),
  digest_date   date not null references digests(date) on delete cascade,
  dimension     text not null,
  score         integer not null,
  feedback      text,
  run_index     integer not null default 0,
  agent_run_id  uuid not null references agent_runs(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint eval_scores_dimension_check check (dimension in (
    'signal_vs_noise','voice','brevity','citation_honesty','coverage'
  )),
  constraint eval_scores_score_range check (score between 1 and 10),
  constraint eval_scores_unique unique (digest_date, dimension, run_index)
);

-- updated_at triggers -------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger digests_set_updated_at
  before update on digests
  for each row execute function set_updated_at();

create trigger themes_set_updated_at
  before update on themes
  for each row execute function set_updated_at();

commit;
