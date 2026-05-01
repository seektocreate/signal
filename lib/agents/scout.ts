import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";

export const SCOUT_MODEL = "claude-haiku-4-5-20251001";

// Cents per token. Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Haiku 4.5: $1.00/MTok input, $5.00/MTok output, $1.25/MTok 5m cache write,
// $0.10/MTok cache read.
const RATE = {
  input: 100 / 1_000_000,
  output: 500 / 1_000_000,
  cacheWrite5m: 125 / 1_000_000,
  cacheRead: 10 / 1_000_000,
} as const;

const REASON_MAX_CHARS = 80;

type TweetRow = Database["public"]["Tables"]["tweets"]["Row"];

export type ScoutDecision = {
  keep: boolean;
  reason: string;
  score: number;
};

export type ScoutCallResult = {
  decision: ScoutDecision;
  agentRunId: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  costCents: number;
  latencyMs: number;
};

export class ScoutParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = "ScoutParseError";
    this.raw = raw;
  }
}

export function formatTweetForScout(tweet: TweetRow): string {
  const name = tweet.author_name ?? "—";
  return `@${tweet.author_handle} (${name}) [${tweet.posted_at}]\n${tweet.text}`;
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  const stripped = t.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  return stripped.trim();
}

function extractFirstObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function validateDecision(parsed: unknown, raw: string): ScoutDecision {
  if (!parsed || typeof parsed !== "object") {
    throw new ScoutParseError(raw, "parsed value is not an object");
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.keep !== "boolean") {
    throw new ScoutParseError(raw, `missing or non-boolean "keep"`);
  }
  if (typeof p.reason !== "string") {
    throw new ScoutParseError(raw, `missing or non-string "reason"`);
  }
  if (typeof p.score !== "number" || p.score < 0 || p.score > 1 || Number.isNaN(p.score)) {
    throw new ScoutParseError(raw, `"score" must be a number in [0, 1]`);
  }
  let reason = p.reason;
  if (reason.length > REASON_MAX_CHARS) {
    console.warn(`[scout] reason truncated from ${reason.length} → ${REASON_MAX_CHARS} chars`);
    reason = reason.slice(0, REASON_MAX_CHARS);
  }
  return { keep: p.keep, reason, score: p.score };
}

export function parseScoutOutput(text: string): ScoutDecision {
  const attempts: string[] = [text.trim(), stripCodeFence(text)];
  const extracted = extractFirstObject(text);
  if (extracted) attempts.push(extracted);

  let lastErr: unknown;
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      return validateDecision(parsed, text);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof ScoutParseError) throw lastErr;
  throw new ScoutParseError(
    text,
    `could not parse JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function computeCostCents(tokens: ScoutCallResult["tokens"]): number {
  const cents =
    tokens.input * RATE.input +
    tokens.output * RATE.output +
    tokens.cacheRead * RATE.cacheRead +
    tokens.cacheCreation * RATE.cacheWrite5m;
  return +cents.toFixed(4);
}

export async function filterTweet(args: {
  supabase: SupabaseClient<Database>;
  anthropic: Anthropic;
  systemPrompt: string;
  tweet: TweetRow;
}): Promise<ScoutCallResult> {
  const { supabase, anthropic, systemPrompt, tweet } = args;

  const inputJson: Json = {
    x_tweet_id: tweet.x_tweet_id,
    author_handle: tweet.author_handle,
    author_name: tweet.author_name,
    text: tweet.text,
    posted_at: tweet.posted_at,
    url: tweet.url,
  };

  const startedAt = new Date();
  const startMs = Date.now();
  let rawText = "";
  let tokens: ScoutCallResult["tokens"] = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  };
  let costCents = 0;

  try {
    const res = await anthropic.messages.create({
      model: SCOUT_MODEL,
      max_tokens: 200,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: formatTweetForScout(tweet) }],
    });

    tokens = {
      input: res.usage.input_tokens ?? 0,
      output: res.usage.output_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreation: res.usage.cache_creation_input_tokens ?? 0,
    };
    costCents = computeCostCents(tokens);

    const block = res.content.find((b) => b.type === "text");
    rawText = block && block.type === "text" ? block.text : "";
    if (!rawText) {
      throw new ScoutParseError(rawText, "no text block in response");
    }

    const decision = parseScoutOutput(rawText);
    const completedAt = new Date();

    const { data: agentRun, error: runErr } = await supabase
      .from("agent_runs")
      .insert({
        digest_date: tweet.digest_date,
        agent: "scout",
        model: SCOUT_MODEL,
        system_prompt: systemPrompt,
        input_json: inputJson,
        output_json: decision as unknown as Json,
        output_text: rawText,
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
    if (runErr || !agentRun) {
      throw new Error(`agent_runs insert failed: ${runErr?.message ?? "no row returned"}`);
    }

    const { error: tweetErr } = await supabase
      .from("tweets")
      .update({
        kept: decision.keep,
        scout_reason: decision.reason,
        scout_score: decision.score,
        scout_model: SCOUT_MODEL,
        scout_run_id: agentRun.id,
      })
      .eq("id", tweet.id);
    if (tweetErr) {
      throw new Error(`tweets update failed: ${tweetErr.message}`);
    }

    return {
      decision,
      agentRunId: agentRun.id,
      tokens,
      costCents,
      latencyMs: Date.now() - startMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("agent_runs").insert({
        digest_date: tweet.digest_date,
        agent: "scout",
        model: SCOUT_MODEL,
        system_prompt: systemPrompt,
        input_json: inputJson,
        output_json: null,
        output_text: rawText || null,
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
      console.error("[scout] failed to record agent_run failure:", recordErr);
    }
    throw err;
  }
}
