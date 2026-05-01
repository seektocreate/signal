import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database, DigestStatus, Json } from "@/lib/db/types";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const COST_CEILING_CENTS = 100;
// Statuses we'll pick up:
// - 'filtering' = Scout just finished, normal run
// - 'theming'   = previous Theme run crashed mid-flight, re-running
// - 'failed'    = previous Theme run failed cleanly, retrying
const ALLOWED_START_STATUSES: DigestStatus[] = ["filtering", "theming", "failed"];

// Cents per token. Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Sonnet 4.6: $3.00/MTok input, $15.00/MTok output, $3.75/MTok 5m cache write,
// $0.30/MTok cache read.
const RATE = {
  input: 300 / 1_000_000,
  output: 1500 / 1_000_000,
  cacheWrite5m: 375 / 1_000_000,
  cacheRead: 30 / 1_000_000,
} as const;

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

type ThemeOutput = {
  title: string;
  summary: string;
  tweet_ids: (string | number)[];
  position: number;
};

class ThemeParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = "ThemeParseError";
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

function parseThemeOutput(text: string): unknown {
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
  throw new ThemeParseError(
    text,
    `could not parse JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function validateThemes(parsed: unknown, validIndices: Set<number>): ThemeOutput[] {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("output is not a JSON object");
  }
  const themesField = (parsed as Record<string, unknown>).themes;
  if (!Array.isArray(themesField)) {
    throw new Error('output is missing a "themes" array');
  }
  if (themesField.length < 2 || themesField.length > 4) {
    throw new Error(`themes count must be 2-4, got ${themesField.length}`);
  }

  const themes: ThemeOutput[] = [];
  const seenIds = new Set<number>();
  const N = validIndices.size;

  for (const t of themesField) {
    if (!t || typeof t !== "object") {
      throw new Error("a theme entry is not an object");
    }
    const tt = t as Record<string, unknown>;

    if (typeof tt.title !== "string" || tt.title.trim().length === 0) {
      throw new Error("theme.title must be a non-empty string");
    }
    if (typeof tt.summary !== "string" || tt.summary.trim().length === 0) {
      throw new Error("theme.summary must be a non-empty string");
    }
    if (typeof tt.position !== "number" || !Number.isInteger(tt.position)) {
      throw new Error("theme.position must be an integer");
    }
    if (!Array.isArray(tt.tweet_ids) || tt.tweet_ids.length === 0) {
      throw new Error("theme.tweet_ids must be a non-empty array");
    }

    const tweetIds: (string | number)[] = [];
    for (const id of tt.tweet_ids) {
      const idx =
        typeof id === "number"
          ? id
          : typeof id === "string"
            ? parseInt(id, 10)
            : NaN;
      if (!Number.isInteger(idx) || !validIndices.has(idx)) {
        throw new Error(
          `invalid tweet_id ${JSON.stringify(id)}: expected integer in [1, ${N}]`,
        );
      }
      if (seenIds.has(idx)) {
        throw new Error(`tweet_id appears in multiple themes: ${idx}`);
      }
      seenIds.add(idx);
      tweetIds.push(id);
    }

    themes.push({
      title: tt.title.trim(),
      summary: tt.summary.trim(),
      position: tt.position,
      tweet_ids: tweetIds,
    });
  }

  const sortedPositions = themes.map((t) => t.position).slice().sort((a, b) => a - b);
  for (let i = 0; i < sortedPositions.length; i++) {
    if (sortedPositions[i] !== i + 1) {
      throw new Error(
        `positions must form 1..N with no gaps; got [${sortedPositions.join(", ")}]`,
      );
    }
  }

  themes.sort((a, b) => a.position - b.position);
  return themes;
}

function computeCostCents(t: Tokens): number {
  const cents =
    t.input * RATE.input +
    t.output * RATE.output +
    t.cacheRead * RATE.cacheRead +
    t.cacheCreation * RATE.cacheWrite5m;
  return +cents.toFixed(4);
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
      `[theme] no digest in status ${ALLOWED_START_STATUSES.join("/")} — run pnpm scout first`,
    );
    process.exit(1);
  }

  const today = digest.date;
  const systemPrompt = readFileSync(path.join(process.cwd(), "prompts/theme.md"), "utf8");
  console.log(`[theme] digest_date=${today}`);

  const startedAt = new Date();
  let rawText = "";
  let tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let costCents = 0;
  let inputJson: Json = { tweets: [] };

  try {
    const { error: setErr } = await supabase
      .from("digests")
      .update({ status: "theming", error: null })
      .eq("date", today);
    if (setErr) throw new Error(`set theming failed: ${setErr.message}`);

    const { error: delErr } = await supabase.from("themes").delete().eq("digest_date", today);
    if (delErr) throw new Error(`themes delete failed: ${delErr.message}`);

    const { data: tweets, error: tweetsErr } = await supabase
      .from("tweets")
      .select("*")
      .eq("digest_date", today)
      .eq("kept", true)
      .order("scout_score", { ascending: false, nullsFirst: false });
    if (tweetsErr) throw new Error(`tweets read failed: ${tweetsErr.message}`);
    if (!tweets || tweets.length === 0) {
      throw new Error("no kept tweets found — nothing to theme");
    }

    const tweetPayload = tweets.map((t, i) => ({
      id: i + 1,
      author: t.author_handle,
      text: t.text,
    }));

    const indexToUuid = new Map<number, string>(
      tweets.map((t, i) => [i + 1, t.id]),
    );
    inputJson = { tweets: tweetPayload } as unknown as Json;

    const userMessage =
      `Here are today's kept tweets (${tweets.length} total). Cluster them into 2-4 narrative themes per the system prompt and return the JSON object specified.\n\n` +
      "```json\n" +
      JSON.stringify({ tweets: tweetPayload }, null, 2) +
      "\n```";

    console.log(`[theme] clustering ${tweets.length} kept tweets via ${MODEL}…`);

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
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
      throw new ThemeParseError(rawText, "no text block in response");
    }

    const parsed = parseThemeOutput(rawText);
    const validIndices = new Set<number>(
      Array.from({ length: tweets.length }, (_, i) => i + 1),
    );
    const themes = validateThemes(parsed, validIndices);

    for (const theme of themes) {
      const { data: themeRow, error: insErr } = await supabase
        .from("themes")
        .insert({
          digest_date: today,
          position: theme.position,
          title: theme.title,
          summary: theme.summary,
        })
        .select("id")
        .single();
      if (insErr || !themeRow) {
        throw new Error(`themes insert failed: ${insErr?.message ?? "no row returned"}`);
      }

      const citations = theme.tweet_ids.map((tid, i) => {
        const idx = typeof tid === "string" ? parseInt(tid, 10) : tid;
        return {
          theme_id: themeRow.id,
          tweet_id: indexToUuid.get(idx)!,
          position: i + 1,
        };
      });
      const { error: citErr } = await supabase.from("theme_citations").insert(citations);
      if (citErr) throw new Error(`theme_citations insert failed: ${citErr.message}`);
    }

    const completedAt = new Date();

    const { error: runErr } = await supabase.from("agent_runs").insert({
      digest_date: today,
      agent: "theme",
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
    });
    if (runErr) throw new Error(`agent_runs insert failed: ${runErr.message}`);

    const newInputTotal = digest.total_input_tokens + tokens.input;
    const newOutputTotal = digest.total_output_tokens + tokens.output;
    const newCostTotal = digest.total_cost_cents + Math.round(costCents);

    const { error: doneErr } = await supabase
      .from("digests")
      .update({
        status: "writing",
        total_input_tokens: newInputTotal,
        total_output_tokens: newOutputTotal,
        total_cost_cents: newCostTotal,
        error: null,
      })
      .eq("date", today);
    if (doneErr) throw new Error(`status -> writing failed: ${doneErr.message}`);

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    const costDollars = (costCents / 100).toFixed(4);
    const covered = themes.reduce((acc, t) => acc + t.tweet_ids.length, 0);

    console.log(
      `[theme] themes=${themes.length} covered=${covered}/${tweets.length} | ` +
        `tokens in=${tokens.input} out=${tokens.output} cache_r=${tokens.cacheRead} cache_w=${tokens.cacheCreation} | ` +
        `cost=$${costDollars} | elapsed=${elapsedSec}s`,
    );
    for (const t of themes) {
      console.log(`[theme]   ${t.position}. ${t.title} (${t.tweet_ids.length} cites)`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("agent_runs").insert({
        digest_date: today,
        agent: "theme",
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
      console.error("[theme] failed to record agent_run failure:", recordErr);
    }
    try {
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
    } catch (recordErr) {
      console.error("[theme] failed to record digest failure:", recordErr);
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
