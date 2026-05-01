import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database, DigestStatus, Json } from "@/lib/db/types";

const MODEL = "claude-sonnet-4-6";
// Adaptive thinking counts toward max_tokens, so we need headroom for both
// the thinking trace and the ~120-word JSON output. Theme uses 4096 because
// it doesn't enable thinking; Writer needs more.
const MAX_TOKENS = 16000;
const COST_CEILING_CENTS = 100;
const TARGET_WORD_COUNT = 120;
const MAX_CITED_TWEETS_PER_THEME = 7;
// Statuses we'll pick up:
// - 'writing' = Theme just finished, OR a previous Writer run drafted some-but-not-all
//   themes. Writer never sets digests to 'failed' — partial completion is recoverable
//   by re-running, which only re-drafts themes whose writer_draft is still null.
// - 'failed'  = an upstream stage left it failed; safe to retry from here.
const ALLOWED_START_STATUSES: DigestStatus[] = ["writing", "failed"];

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

type CitedTweet = {
  position: number;
  author_handle: string;
  author_name: string;
  text: string;
  url: string;
};

type WriterInput = {
  theme_title: string;
  theme_summary: string;
  cited_tweets: CitedTweet[];
  target_word_count: number;
};

type WriterOutput = { draft: string };

class WriterParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = "WriterParseError";
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

function parseWriterOutput(text: string): unknown {
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
  throw new WriterParseError(
    text,
    `could not parse JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function validateWriterOutput(parsed: unknown): WriterOutput {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("output is not a JSON object");
  }
  const d = (parsed as Record<string, unknown>).draft;
  if (typeof d !== "string" || d.trim().length === 0) {
    throw new Error("output.draft must be a non-empty string");
  }
  return { draft: d };
}

function computeCostCents(t: Tokens): number {
  const cents =
    t.input * RATE.input +
    t.output * RATE.output +
    t.cacheRead * RATE.cacheRead +
    t.cacheCreation * RATE.cacheWrite5m;
  return +cents.toFixed(4);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
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
      `[writer] no digest in status ${ALLOWED_START_STATUSES.join("/")} — run pnpm theme first`,
    );
    process.exit(1);
  }

  const today = digest.date;
  const systemPrompt = readFileSync(
    path.join(process.cwd(), "prompts/writer.md"),
    "utf8",
  );
  console.log(`[writer] digest_date=${today}`);

  const { error: setErr } = await supabase
    .from("digests")
    .update({ status: "writing", error: null })
    .eq("date", today);
  if (setErr) throw new Error(`set writing failed: ${setErr.message}`);

  const { data: themes, error: themesErr } = await supabase
    .from("themes")
    .select("*")
    .eq("digest_date", today)
    .order("position", { ascending: true });
  if (themesErr) throw new Error(`themes read failed: ${themesErr.message}`);
  if (!themes || themes.length === 0) {
    throw new Error("no themes found — run pnpm theme first");
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
  const citationsByTheme = new Map<string, string[]>();
  for (const c of citations) {
    const arr = citationsByTheme.get(c.theme_id) ?? [];
    arr.push(c.tweet_id);
    citationsByTheme.set(c.theme_id, arr);
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCostCents = 0;
  let drafted = 0;
  let skipped = 0;

  for (const theme of themes) {
    if (theme.writer_draft !== null) {
      skipped++;
      console.log(
        `[writer]   ${theme.position}. ${theme.title} (already drafted, skipping)`,
      );
      continue;
    }

    const themeTweetIds = citationsByTheme.get(theme.id) ?? [];
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

    const citedTweets: CitedTweet[] = ranked.map((t, i) => ({
      position: i + 1,
      author_handle: t.author_handle,
      author_name: t.author_name ?? "",
      text: t.text,
      url: t.url,
    }));

    const input: WriterInput = {
      theme_title: theme.title,
      theme_summary: theme.summary,
      cited_tweets: citedTweets,
      target_word_count: TARGET_WORD_COUNT,
    };
    const inputJson = input as unknown as Json;

    const startedAt = new Date();
    let rawText = "";
    let parsed: unknown = null;
    let tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    let costCents = 0;

    try {
      console.log(
        `[writer]   ${theme.position}. ${theme.title} (cites=${citedTweets.length}) drafting…`,
      );

      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // High effort is the default for adaptive thinking on Sonnet 4.6, so
        // we don't pass `effort` explicitly. The SDK 0.92 types don't include
        // the `effort` field yet; behavior is identical without it.
        thinking: { type: "adaptive" },
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

      if (totalCostCents + costCents > COST_CEILING_CENTS) {
        throw new Error(
          `cost ceiling hit: $${((totalCostCents + costCents) / 100).toFixed(4)} > $${(COST_CEILING_CENTS / 100).toFixed(2)}`,
        );
      }

      const block = res.content.find((b) => b.type === "text");
      rawText = block && block.type === "text" ? block.text : "";
      if (!rawText) {
        throw new WriterParseError(rawText, "no text block in response");
      }

      parsed = parseWriterOutput(rawText);
      const out = validateWriterOutput(parsed);

      const { error: updErr } = await supabase
        .from("themes")
        .update({ writer_draft: out.draft })
        .eq("id", theme.id);
      if (updErr) throw new Error(`themes update failed: ${updErr.message}`);

      const completedAt = new Date();

      const { error: runErr } = await supabase.from("agent_runs").insert({
        digest_date: today,
        theme_id: theme.id,
        agent: "writer",
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

      totalInput += tokens.input;
      totalOutput += tokens.output;
      totalCacheRead += tokens.cacheRead;
      totalCacheCreation += tokens.cacheCreation;
      totalCostCents += costCents;
      drafted++;

      console.log(
        `[writer]   ${theme.position}. drafted ${wordCount(out.draft)} words | ` +
          `tokens in=${tokens.input} out=${tokens.output} cache_r=${tokens.cacheRead} cache_w=${tokens.cacheCreation} | ` +
          `cost=$${(costCents / 100).toFixed(4)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await supabase.from("agent_runs").insert({
          digest_date: today,
          theme_id: theme.id,
          agent: "writer",
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
        console.error("[writer] failed to record agent_run failure:", recordErr);
      }
      throw err;
    }
  }

  // Reaching here means every theme either was already drafted or got drafted now.
  // The per-theme catch re-throws on any failure, so partial completion can't
  // sneak past this point.
  const newInputTotal = digest.total_input_tokens + totalInput;
  const newOutputTotal = digest.total_output_tokens + totalOutput;
  const newCostTotal = digest.total_cost_cents + Math.round(totalCostCents);

  const { error: doneErr } = await supabase
    .from("digests")
    .update({
      status: "editing",
      total_input_tokens: newInputTotal,
      total_output_tokens: newOutputTotal,
      total_cost_cents: newCostTotal,
      error: null,
    })
    .eq("date", today);
  if (doneErr) throw new Error(`status -> editing failed: ${doneErr.message}`);

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  const costDollars = (totalCostCents / 100).toFixed(4);

  console.log(
    `[writer] themes=${themes.length} drafted=${drafted} skipped=${skipped} | ` +
      `tokens in=${totalInput} out=${totalOutput} cache_r=${totalCacheRead} cache_w=${totalCacheCreation} | ` +
      `cost=$${costDollars} | elapsed=${elapsedSec}s | status=editing`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
