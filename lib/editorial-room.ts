import "server-only";
import { supabase } from "@/lib/db/client";
import type {
  AgentName,
  CitationRole,
  DigestStatus,
  EvalDimension,
  Json,
} from "@/lib/db/types";

export type EditorialRoomTweet = {
  id: string;
  x_tweet_id: string;
  author_handle: string;
  author_name: string | null;
  text: string;
  posted_at: string;
  url: string;
  scout: {
    kept: boolean | null;
    reason: string | null;
    score: number | null;
    model: string | null;
  };
};

export type EditorialRoomCitation = {
  position: number;
  role: CitationRole;
  tweet: EditorialRoomTweet;
};

export type EditorialRoomTheme = {
  id: string;
  position: number;
  title: string;
  summary: string;
  writer_draft: string;
  editor_final: string;
  citations: EditorialRoomCitation[];
};

export type EditorialRoomEvalDimension = {
  dimension: EvalDimension;
  score: number;
  feedback: string | null;
  issues: string[];
  reasoning: string;
  suggestions: string[];
};

export type EditorialRoomEval = {
  run_index: number;
  total_runs: number;
  dimensions: EditorialRoomEvalDimension[];
};

export type EditorialRoomStageMetrics = {
  agent: AgentName;
  total_runs: number;
  failed_runs: number;
  models: string[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_cents: number;
  wall_clock_ms: number | null;
};

export type EditorialRoomRunMetadata = {
  total_runs: number;
  failed_runs: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_cents: number;
  digest_total_cost_cents: number;
  by_stage: EditorialRoomStageMetrics[];
};

export type EditorialRoomViewModel = {
  digest_date: string;
  status: DigestStatus;
  started_at: string | null;
  completed_at: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  eval_score_overall: number | null;
  tweets: EditorialRoomTweet[];
  themes: EditorialRoomTheme[];
  unthemed_kept_tweets: EditorialRoomTweet[];
  eval: EditorialRoomEval;
  runs: EditorialRoomRunMetadata;
};

const STAGE_ORDER: AgentName[] = ["scout", "theme", "writer", "editor", "eval"];

const EVAL_DIMENSIONS: EvalDimension[] = [
  "signal_vs_noise",
  "voice",
  "brevity",
  "citation_honesty",
  "coverage",
];

type ParsedEvalDimension = {
  issues: string[];
  reasoning: string;
  suggestions: string[];
};

type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(v: Json | undefined): v is JsonObject {
  return (
    v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)
  );
}

function parseEvalDimension(
  outputJson: Json | null,
  dimension: EvalDimension,
  date: string,
  runIndex: number,
): ParsedEvalDimension {
  if (outputJson === null || !isJsonObject(outputJson)) {
    throw new Error(
      `eval agent_run for digest ${date} run_index=${runIndex}: output_json is null or not an object`,
    );
  }
  const scores = outputJson.scores;
  if (!isJsonObject(scores)) {
    throw new Error(
      `eval agent_run for digest ${date} run_index=${runIndex}: output_json.scores missing or not an object`,
    );
  }
  const dim = scores[dimension];
  if (!isJsonObject(dim)) {
    throw new Error(
      `eval agent_run for digest ${date} run_index=${runIndex}: output_json.scores['${dimension}'] missing or not an object`,
    );
  }
  const issues = dim.issues;
  const reasoning = dim.reasoning;
  const suggestions = dim.suggestions;
  if (!Array.isArray(issues) || !issues.every((s) => typeof s === "string")) {
    throw new Error(
      `eval ${date}/${dimension}: output_json.scores.issues is not a string[]`,
    );
  }
  if (typeof reasoning !== "string") {
    throw new Error(
      `eval ${date}/${dimension}: output_json.scores.reasoning is not a string`,
    );
  }
  if (
    !Array.isArray(suggestions) ||
    !suggestions.every((s) => typeof s === "string")
  ) {
    throw new Error(
      `eval ${date}/${dimension}: output_json.scores.suggestions is not a string[]`,
    );
  }
  return { issues, reasoning, suggestions };
}

export async function getEditorialRoomData(
  date: string,
): Promise<EditorialRoomViewModel | null> {
  const { data: digest, error: digestErr } = await supabase
    .from("digests")
    .select(
      "date, status, started_at, completed_at, total_input_tokens, total_output_tokens, total_cost_cents, eval_score_overall",
    )
    .eq("date", date)
    .maybeSingle();
  if (digestErr) throw new Error(`digest read failed: ${digestErr.message}`);
  if (!digest) return null;

  const { data: tweetRowsRaw, error: tweetsErr } = await supabase
    .from("tweets")
    .select(
      "id, x_tweet_id, author_handle, author_name, text, posted_at, url, kept, scout_reason, scout_score, scout_model",
    )
    .eq("digest_date", date)
    .order("posted_at", { ascending: false });
  if (tweetsErr) throw new Error(`tweets read failed: ${tweetsErr.message}`);
  const tweetRows = tweetRowsRaw ?? [];

  const tweets: EditorialRoomTweet[] = tweetRows.map((t) => ({
    id: t.id,
    x_tweet_id: t.x_tweet_id,
    author_handle: t.author_handle,
    author_name: t.author_name,
    text: t.text,
    posted_at: t.posted_at,
    url: t.url,
    scout: {
      kept: t.kept,
      reason: t.scout_reason,
      score: t.scout_score,
      model: t.scout_model,
    },
  }));

  const tweetById = new Map<string, EditorialRoomTweet>();
  for (const tw of tweets) tweetById.set(tw.id, tw);

  const { data: themeRowsRaw, error: themesErr } = await supabase
    .from("themes")
    .select("id, position, title, summary, writer_draft, editor_final")
    .eq("digest_date", date)
    .order("position", { ascending: true });
  if (themesErr) throw new Error(`themes read failed: ${themesErr.message}`);
  if (!themeRowsRaw || themeRowsRaw.length === 0) {
    throw new Error(`digest ${date} has no themes`);
  }
  const themeRows = themeRowsRaw;

  const themeIds = themeRows.map((t) => t.id);
  const { data: citationRowsRaw, error: citErr } =
    themeIds.length > 0
      ? await supabase
          .from("theme_citations")
          .select("theme_id, tweet_id, position, role")
          .in("theme_id", themeIds)
          .order("position", { ascending: true })
      : { data: [], error: null as null };
  if (citErr) throw new Error(`theme_citations read failed: ${citErr.message}`);
  const citationRows = citationRowsRaw ?? [];

  const citationsByTheme = new Map<string, EditorialRoomCitation[]>();
  const citedTweetIds = new Set<string>();
  let orphanCount = 0;
  for (const c of citationRows) {
    const tw = tweetById.get(c.tweet_id);
    if (!tw) {
      orphanCount++;
      continue;
    }
    citedTweetIds.add(c.tweet_id);
    const arr = citationsByTheme.get(c.theme_id) ?? [];
    arr.push({ position: c.position, role: c.role, tweet: tw });
    citationsByTheme.set(c.theme_id, arr);
  }
  if (orphanCount > 0) {
    throw new Error(
      `digest ${date}: ${orphanCount} theme_citations reference tweets outside the digest_date window`,
    );
  }

  const themes: EditorialRoomTheme[] = themeRows.map((t) => {
    if (t.writer_draft === null) {
      throw new Error(
        `theme position=${t.position} on ${date} has no writer_draft`,
      );
    }
    if (t.editor_final === null) {
      throw new Error(
        `theme position=${t.position} on ${date} has no editor_final`,
      );
    }
    return {
      id: t.id,
      position: t.position,
      title: t.title,
      summary: t.summary,
      writer_draft: t.writer_draft,
      editor_final: t.editor_final,
      citations: citationsByTheme.get(t.id) ?? [],
    };
  });

  const unthemed_kept_tweets = tweets.filter(
    (tw) => tw.scout.kept === true && !citedTweetIds.has(tw.id),
  );

  const { data: runRowsRaw, error: runsErr } = await supabase
    .from("agent_runs")
    .select(
      "id, agent, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents, started_at, completed_at, error, output_json",
    )
    .eq("digest_date", date);
  if (runsErr) throw new Error(`agent_runs read failed: ${runsErr.message}`);
  const runRows = runRowsRaw ?? [];

  type RunRow = (typeof runRows)[number];
  const runsByAgent = new Map<AgentName, RunRow[]>();
  for (const r of runRows) {
    const arr = runsByAgent.get(r.agent) ?? [];
    arr.push(r);
    runsByAgent.set(r.agent, arr);
  }

  const by_stage: EditorialRoomStageMetrics[] = STAGE_ORDER.map((agent) => {
    const stage = runsByAgent.get(agent) ?? [];
    let failed_runs = 0;
    const modelsSet = new Set<string>();
    let input_tokens = 0;
    let output_tokens = 0;
    let cache_read_tokens = 0;
    let cache_creation_tokens = 0;
    let cost_cents = 0;
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;
    let anyPending = false;
    for (const r of stage) {
      if (r.error !== null) failed_runs++;
      modelsSet.add(r.model);
      input_tokens += r.input_tokens;
      output_tokens += r.output_tokens;
      cache_read_tokens += r.cache_read_tokens;
      cache_creation_tokens += r.cache_creation_tokens;
      cost_cents += r.cost_cents;
      const startMs = Date.parse(r.started_at);
      if (Number.isFinite(startMs) && startMs < minStart) minStart = startMs;
      if (r.completed_at === null) {
        anyPending = true;
      } else {
        const endMs = Date.parse(r.completed_at);
        if (Number.isFinite(endMs) && endMs > maxEnd) maxEnd = endMs;
      }
    }
    const wall_clock_ms =
      stage.length === 0 ||
      anyPending ||
      !Number.isFinite(minStart) ||
      !Number.isFinite(maxEnd)
        ? null
        : Math.max(0, maxEnd - minStart);
    return {
      agent,
      total_runs: stage.length,
      failed_runs,
      models: Array.from(modelsSet).sort(),
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_creation_tokens,
      cost_cents,
      wall_clock_ms,
    };
  });

  const total_cost_cents = runRows.reduce((s, r) => s + r.cost_cents, 0);
  const total_input_tokens_runs = runRows.reduce(
    (s, r) => s + r.input_tokens,
    0,
  );
  const total_output_tokens_runs = runRows.reduce(
    (s, r) => s + r.output_tokens,
    0,
  );
  const total_cache_read_tokens = runRows.reduce(
    (s, r) => s + r.cache_read_tokens,
    0,
  );
  const total_cache_creation_tokens = runRows.reduce(
    (s, r) => s + r.cache_creation_tokens,
    0,
  );
  const total_failures = runRows.filter((r) => r.error !== null).length;

  const runMetadata: EditorialRoomRunMetadata = {
    total_runs: runRows.length,
    failed_runs: total_failures,
    total_input_tokens: total_input_tokens_runs,
    total_output_tokens: total_output_tokens_runs,
    total_cache_read_tokens,
    total_cache_creation_tokens,
    total_cost_cents,
    digest_total_cost_cents: digest.total_cost_cents,
    by_stage,
  };

  const { data: scoreRowsRaw, error: scoresErr } = await supabase
    .from("eval_scores")
    .select("dimension, score, feedback, run_index, agent_run_id")
    .eq("digest_date", date);
  if (scoresErr)
    throw new Error(`eval_scores read failed: ${scoresErr.message}`);
  const scoreRows = scoreRowsRaw ?? [];

  if (scoreRows.length === 0) {
    throw new Error(`digest ${date} has no eval_scores`);
  }

  const distinctRunIndices = Array.from(
    new Set(scoreRows.map((s) => s.run_index)),
  );
  const total_eval_runs = distinctRunIndices.length;
  const latestRunIndex = Math.max(...distinctRunIndices);
  const scoresAtLatest = scoreRows.filter(
    (s) => s.run_index === latestRunIndex,
  );

  const presentDims = new Set(scoresAtLatest.map((s) => s.dimension));
  for (const d of EVAL_DIMENSIONS) {
    if (!presentDims.has(d)) {
      throw new Error(
        `digest ${date} eval at run_index=${latestRunIndex} missing dimension '${d}'`,
      );
    }
  }
  if (scoresAtLatest.length !== EVAL_DIMENSIONS.length) {
    throw new Error(
      `digest ${date} eval at run_index=${latestRunIndex} has ${scoresAtLatest.length} dimension rows; expected ${EVAL_DIMENSIONS.length}`,
    );
  }

  const evalRunOutputById = new Map<string, Json | null>();
  for (const r of runRows) {
    if (r.agent === "eval") evalRunOutputById.set(r.id, r.output_json);
  }

  const scoreByDim = new Map<EvalDimension, (typeof scoresAtLatest)[number]>();
  for (const s of scoresAtLatest) scoreByDim.set(s.dimension, s);

  const dimensions: EditorialRoomEvalDimension[] = EVAL_DIMENSIONS.map(
    (dim) => {
      const row = scoreByDim.get(dim);
      if (!row) {
        throw new Error(
          `digest ${date} eval at run_index=${latestRunIndex} missing dimension '${dim}'`,
        );
      }
      if (!evalRunOutputById.has(row.agent_run_id)) {
        throw new Error(
          `digest ${date} eval ${dim}: agent_run_id ${row.agent_run_id} not found in agent_runs (or not an eval run)`,
        );
      }
      const outputJson = evalRunOutputById.get(row.agent_run_id) ?? null;
      const parsed = parseEvalDimension(outputJson, dim, date, latestRunIndex);
      return {
        dimension: dim,
        score: row.score,
        feedback: row.feedback,
        issues: parsed.issues,
        reasoning: parsed.reasoning,
        suggestions: parsed.suggestions,
      };
    },
  );

  const evalSection: EditorialRoomEval = {
    run_index: latestRunIndex,
    total_runs: total_eval_runs,
    dimensions,
  };

  return {
    digest_date: digest.date,
    status: digest.status,
    started_at: digest.started_at,
    completed_at: digest.completed_at,
    total_input_tokens: digest.total_input_tokens,
    total_output_tokens: digest.total_output_tokens,
    total_cost_cents: digest.total_cost_cents,
    eval_score_overall: digest.eval_score_overall,
    tweets,
    themes,
    unthemed_kept_tweets,
    eval: evalSection,
    runs: runMetadata,
  };
}
