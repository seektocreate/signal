import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type {
  Database,
  DigestStatus,
  EvalDimension,
  Json,
} from "@/lib/db/types";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 16000;
// SDK ThinkingConfigEnabled requires budget_tokens >= 1024 and < max_tokens.
const THINKING_BUDGET = 8000;
const COST_CEILING_CENTS = 20;
const TARGET_WORD_COUNT = 120;
const MAX_CITED_TWEETS_PER_THEME = 7;

// Allowed start statuses:
// - 'evaluating' = Editor just finished (upstream-completion) AND Eval's own
//   in-progress label. Eval is atomic, so a crashed prior run leaves the
//   digest visibly stuck in 'evaluating' until retry.
// - 'failed'    = previous Eval run failed cleanly, retrying.
// - 'complete'  = Eval is the first agent using increment-run_index for
//   re-run hygiene (rather than delete-before-rerun); that pattern only
//   coheres if the status filter also admits the post-success status, so
//   prompt-iteration re-invocation just works without manual SQL.
const ALLOWED_START_STATUSES: DigestStatus[] = [
  "evaluating",
  "failed",
  "complete",
];

// Cents per token. Verified 2026-05-03 against Anthropic pricing docs:
// Haiku 4.5 — $1/MTok input, $5/MTok output, $1.25/MTok cache 5m write,
// $0.10/MTok cache read.
const RATE = {
  input: 100 / 1_000_000,
  output: 500 / 1_000_000,
  cacheWrite5m: 125 / 1_000_000,
  cacheRead: 10 / 1_000_000,
} as const;

const DIMENSIONS: EvalDimension[] = [
  "signal_vs_noise",
  "voice",
  "brevity",
  "citation_honesty",
  "coverage",
];

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
}
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY must be set");
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic();

type Tokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

type EvalInputTweet = {
  position: number;
  author_handle: string;
  author_name: string;
  text: string;
  url: string;
};

type EvalInputTheme = {
  position: number;
  title: string;
  summary: string;
  editor_final: string;
  cited_tweets: EvalInputTweet[];
};

type EvalInput = {
  digest_date: string;
  kept_tweets: EvalInputTweet[];
  themes: EvalInputTheme[];
  target_word_count: number;
};

type DimensionScore = {
  score: number;
  issues: unknown[];
  reasoning: string;
  suggestions: unknown[];
};

type EvalOutput = {
  scores: Record<EvalDimension, DimensionScore>;
};

class EvalParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = "EvalParseError";
    this.raw = raw;
  }
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

function extractFirstObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseEvalOutput(text: string): unknown {
  const attempts: string[] = [text.trim(), stripCodeFence(text)];
  const extracted = extractFirstObject(text);
  if (extracted) attempts.push(extracted);

  let lastErr: unknown;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new EvalParseError(
    text,
    `could not parse JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function validateEvalOutput(parsed: unknown): EvalOutput {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("output is not a JSON object");
  }
  const scoresField = (parsed as Record<string, unknown>).scores;
  if (!scoresField || typeof scoresField !== "object") {
    throw new Error('output is missing a "scores" object');
  }
  const scores = scoresField as Record<string, unknown>;
  const result = {} as Record<EvalDimension, DimensionScore>;
  for (const dim of DIMENSIONS) {
    const v = scores[dim];
    if (!v || typeof v !== "object") {
      throw new Error(`scores.${dim} is missing or not an object`);
    }
    const d = v as Record<string, unknown>;
    if (
      typeof d.score !== "number" ||
      !Number.isInteger(d.score) ||
      d.score < 1 ||
      d.score > 10
    ) {
      throw new Error(`scores.${dim}.score must be an integer 1-10`);
    }
    if (!Array.isArray(d.issues)) {
      throw new Error(`scores.${dim}.issues must be an array`);
    }
    if (typeof d.reasoning !== "string" || d.reasoning.trim().length === 0) {
      throw new Error(`scores.${dim}.reasoning must be a non-empty string`);
    }
    if (!Array.isArray(d.suggestions)) {
      throw new Error(`scores.${dim}.suggestions must be an array`);
    }
    result[dim] = {
      score: d.score,
      issues: d.issues,
      reasoning: d.reasoning,
      suggestions: d.suggestions,
    };
  }
  return { scores: result };
}

function computeCostCents(t: Tokens): number {
  const cents =
    t.input * RATE.input +
    t.output * RATE.output +
    t.cacheRead * RATE.cacheRead +
    t.cacheCreation * RATE.cacheWrite5m;
  return +cents.toFixed(4);
}

function stitchFeedback(d: DimensionScore): string {
  const parts: string[] = [d.reasoning.trim()];
  const issues = d.issues
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  if (issues.length) {
    parts.push(`Issues: ${issues.join("; ")}.`);
  }
  const suggestions = d.suggestions
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  if (suggestions.length) {
    parts.push(`Suggestions: ${suggestions.join("; ")}.`);
  }
  return parts.join("\n\n");
}

async function main() {
  const start = Date.now();

  const { data: digest, error: digestErr } = await supabase
    .from("digests")
    .select("*")
    .in("status", ALLOWED_START_STATUSES)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (digestErr) throw new Error(`digest read failed: ${digestErr.message}`);
  if (!digest) {
    console.error(
      `[eval] no digest in status ${ALLOWED_START_STATUSES.join("/")} — run pnpm editor first`,
    );
    process.exit(1);
  }

  const today = digest.date;
  const systemPrompt = readFileSync(
    path.join(process.cwd(), "prompts/eval.md"),
    "utf8",
  );
  console.log(`[eval] digest_date=${today}`);

  const startedAt = new Date();
  let rawText = "";
  let parsed: unknown = null;
  let tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let costCents = 0;
  let inputJson: Json = {
    digest_date: today,
    kept_tweets: [],
    themes: [],
    target_word_count: TARGET_WORD_COUNT,
  } as unknown as Json;

  try {
    const { error: setErr } = await supabase
      .from("digests")
      .update({ status: "evaluating", error: null })
      .eq("date", today);
    if (setErr) throw new Error(`set evaluating failed: ${setErr.message}`);

    // Re-run pattern: increment run_index, do NOT delete prior eval_scores
    // rows. Diverges from Theme/Editor's delete-before-rerun pattern —
    // preserving scoring history is the natural fit for prompt iteration on
    // Eval. The unique constraint (digest_date, dimension, run_index)
    // enforces no collision per re-run.
    const { data: prior, error: priorErr } = await supabase
      .from("eval_scores")
      .select("run_index")
      .eq("digest_date", today)
      .order("run_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorErr)
      throw new Error(`eval_scores prior read failed: ${priorErr.message}`);
    const nextRunIndex = (prior?.run_index ?? -1) + 1;

    // Load kept tweets — full kept set; Eval's unique view is signal-vs-noise
    // and coverage judged against the source set Scout produced.
    const { data: keptTweets, error: keptErr } = await supabase
      .from("tweets")
      .select("author_handle, author_name, text, url, scout_score")
      .eq("digest_date", today)
      .eq("kept", true);
    if (keptErr) throw new Error(`kept tweets read failed: ${keptErr.message}`);
    if (!keptTweets || keptTweets.length === 0) {
      throw new Error("no kept tweets found for digest — run pnpm scout first");
    }

    const rankedKept = [...keptTweets].sort((a, b) => {
      const sa = a.scout_score ?? -Infinity;
      const sb = b.scout_score ?? -Infinity;
      return sb - sa;
    });
    const kept_tweets: EvalInputTweet[] = rankedKept.map((t, i) => ({
      position: i + 1,
      author_handle: t.author_handle,
      author_name: t.author_name ?? "",
      text: t.text,
      url: t.url,
    }));

    const { data: themes, error: themesErr } = await supabase
      .from("themes")
      .select("*")
      .eq("digest_date", today)
      .order("position", { ascending: true });
    if (themesErr) throw new Error(`themes read failed: ${themesErr.message}`);
    if (!themes || themes.length === 0) {
      throw new Error("no themes found — run pnpm theme first");
    }
    for (const t of themes) {
      if (t.editor_final === null) {
        throw new Error(
          `theme position=${t.position} has no editor_final — run pnpm editor first`,
        );
      }
    }

    const themeIds = themes.map((t) => t.id);
    const { data: citations, error: citErr } = await supabase
      .from("theme_citations")
      .select("theme_id, tweet_id")
      .in("theme_id", themeIds);
    if (citErr) throw new Error(`theme_citations read failed: ${citErr.message}`);
    if (!citations || citations.length === 0) {
      throw new Error("no theme_citations found — themes have no source tweets");
    }

    const tweetIds = Array.from(new Set(citations.map((c) => c.tweet_id)));
    const { data: tweets, error: tweetsErr } = await supabase
      .from("tweets")
      .select("id, author_handle, author_name, text, url, scout_score")
      .in("id", tweetIds);
    if (tweetsErr) throw new Error(`tweets read failed: ${tweetsErr.message}`);
    if (!tweets || tweets.length === 0) {
      throw new Error("no tweets found for cited theme_citations");
    }

    const tweetById = new Map(tweets.map((t) => [t.id, t]));
    const tweetIdsByTheme = new Map<string, string[]>();
    for (const c of citations) {
      const arr = tweetIdsByTheme.get(c.theme_id) ?? [];
      arr.push(c.tweet_id);
      tweetIdsByTheme.set(c.theme_id, arr);
    }

    const inputThemes: EvalInputTheme[] = themes.map((theme) => {
      const themeTweetIds = tweetIdsByTheme.get(theme.id) ?? [];
      const ranked = themeTweetIds
        .map((id) => tweetById.get(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .sort((a, b) => {
          const sa = a.scout_score ?? -Infinity;
          const sb = b.scout_score ?? -Infinity;
          return sb - sa;
        })
        .slice(0, MAX_CITED_TWEETS_PER_THEME);

      if (ranked.length === 0) {
        throw new Error(
          `theme ${theme.position} (${theme.id}) has no citable tweets`,
        );
      }

      const cited_tweets: EvalInputTweet[] = ranked.map((t, i) => ({
        position: i + 1,
        author_handle: t.author_handle,
        author_name: t.author_name ?? "",
        text: t.text,
        url: t.url,
      }));

      return {
        position: theme.position,
        title: theme.title,
        summary: theme.summary,
        editor_final: theme.editor_final as string,
        cited_tweets,
      };
    });

    const input: EvalInput = {
      digest_date: today,
      kept_tweets,
      themes: inputThemes,
      target_word_count: TARGET_WORD_COUNT,
    };
    inputJson = input as unknown as Json;

    console.log(
      `[eval] scoring 5 dimensions via ${MODEL} (manual thinking, budget=${THINKING_BUDGET})…`,
    );

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Manual thinking only on Haiku 4.5. Adaptive thinking, `output_config`,
      // and `effort` are Opus-4.7+ exclusive (verified against current
      // Anthropic docs and SDK 0.92 ThinkingConfigEnabled type, 2026-05-03).
      thinking: {
        type: "enabled",
        budget_tokens: THINKING_BUDGET,
        display: "summarized",
      },
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });

    tokens = {
      input: res.usage.input_tokens ?? 0,
      output: res.usage.output_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreation: res.usage.cache_creation_input_tokens ?? 0,
    };
    costCents = computeCostCents(tokens);

    if (costCents > COST_CEILING_CENTS) {
      throw new Error(
        `cost ceiling hit: $${(costCents / 100).toFixed(4)} > $${(COST_CEILING_CENTS / 100).toFixed(2)}`,
      );
    }

    const block = res.content.find((b) => b.type === "text");
    rawText = block && block.type === "text" ? block.text : "";
    if (!rawText) {
      throw new EvalParseError(rawText, "no text block in response");
    }

    parsed = parseEvalOutput(rawText);
    const out = validateEvalOutput(parsed);

    const completedAt = new Date();

    const { data: agentRunRow, error: runErr } = await supabase
      .from("agent_runs")
      .insert({
        digest_date: today,
        theme_id: null,
        agent: "eval",
        model: MODEL,
        system_prompt: systemPrompt,
        input_json: inputJson,
        output_text: rawText,
        output_json: parsed as Json,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_tokens: tokens.cacheRead,
        cache_creation_tokens: tokens.cacheCreation,
        cost_cents: costCents,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
      })
      .select("id")
      .single();
    if (runErr) throw new Error(`agent_runs insert failed: ${runErr.message}`);
    const agentRunId = agentRunRow.id;

    const evalRows = DIMENSIONS.map((dim) => ({
      digest_date: today,
      dimension: dim,
      score: out.scores[dim].score,
      feedback: stitchFeedback(out.scores[dim]),
      run_index: nextRunIndex,
      agent_run_id: agentRunId,
    }));
    const { error: scoresErr } = await supabase
      .from("eval_scores")
      .insert(evalRows);
    if (scoresErr)
      throw new Error(`eval_scores insert failed: ${scoresErr.message}`);

    const newInputTotal = digest.total_input_tokens + tokens.input;
    const newOutputTotal = digest.total_output_tokens + tokens.output;
    const newCostTotal = digest.total_cost_cents + Math.round(costCents);

    const { error: doneErr } = await supabase
      .from("digests")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        total_input_tokens: newInputTotal,
        total_output_tokens: newOutputTotal,
        total_cost_cents: newCostTotal,
        error: null,
      })
      .eq("date", today);
    if (doneErr) throw new Error(`status -> complete failed: ${doneErr.message}`);

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    const costDollars = (costCents / 100).toFixed(4);

    console.log(
      `[eval] dimensions=${DIMENSIONS.length} | ` +
        `tokens in=${tokens.input} out=${tokens.output} cache_r=${tokens.cacheRead} cache_w=${tokens.cacheCreation} | ` +
        `cost=$${costDollars} | elapsed=${elapsedSec}s | status=complete`,
    );
    for (const dim of DIMENSIONS) {
      const d = out.scores[dim];
      const issuesLabel = d.issues.length === 1 ? "issue" : "issues";
      console.log(
        `[eval]   ${dim}: ${d.score} (${d.issues.length} ${issuesLabel})`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("agent_runs").insert({
        digest_date: today,
        theme_id: null,
        agent: "eval",
        model: MODEL,
        system_prompt: systemPrompt,
        input_json: inputJson,
        output_text: rawText || null,
        output_json: null,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_tokens: tokens.cacheRead,
        cache_creation_tokens: tokens.cacheCreation,
        cost_cents: costCents,
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        error: message,
      });
    } catch (recordErr) {
      console.error("[eval] failed to record agent_run failure:", recordErr);
    }
    try {
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
    } catch (recordErr) {
      console.error("[eval] failed to record digest failure:", recordErr);
    }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
