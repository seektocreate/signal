import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database, DigestStatus, Json } from "@/lib/db/types";

const MODEL = "claude-opus-4-7";
// Adaptive thinking + JSON output for 4 polished drafts. Writer needed 16k for
// one theme; Editor batches all four, so 20k.
const MAX_TOKENS = 20000;
const COST_CEILING_CENTS = 100;
const TARGET_WORD_COUNT = 120;
const MAX_CITED_TWEETS_PER_THEME = 7;
// Allowed start statuses:
// - 'editing' = Writer just finished (upstream-completion) AND Editor's own
//   in-progress label. Editor is atomic, so a crashed prior run leaves the
//   digest visibly stuck in 'editing' until retry.
// - 'failed'  = previous Editor run failed cleanly, retrying.
const ALLOWED_START_STATUSES: DigestStatus[] = ["editing", "failed"];

// Cents per token. Verified 2026-05-03 against Anthropic pricing docs and
// finout.io / cloudzero coverage of Opus 4.7. Rates unchanged from Opus 4.6:
// $5/MTok input, $25/MTok output. Cache 5m write at 1.25x input ($6.25/MTok),
// cache read at 90% discount ($0.50/MTok).
const RATE = {
  input: 500 / 1_000_000,
  output: 2500 / 1_000_000,
  cacheWrite5m: 625 / 1_000_000,
  cacheRead: 50 / 1_000_000,
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

type EditorInputTheme = {
  position: number;
  title: string;
  summary: string;
  writer_draft: string;
  cited_tweets: CitedTweet[];
};

type EditorInput = {
  themes: EditorInputTheme[];
  target_word_count: number;
};

type EditorOutputTheme = { position: number; editor_final: string };
type EditorOutput = { themes: EditorOutputTheme[] };

class EditorParseError extends Error {
  raw: string;
  constructor(raw: string, message: string) {
    super(message);
    this.name = "EditorParseError";
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

function parseEditorOutput(text: string): unknown {
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
  throw new EditorParseError(
    text,
    `could not parse JSON: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function validateEditorOutput(
  parsed: unknown,
  expectedPositions: number[],
): EditorOutput {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("output is not a JSON object");
  }
  const themesField = (parsed as Record<string, unknown>).themes;
  if (!Array.isArray(themesField)) {
    throw new Error('output is missing a "themes" array');
  }
  if (themesField.length !== expectedPositions.length) {
    throw new Error(
      `themes count mismatch: expected ${expectedPositions.length}, got ${themesField.length}`,
    );
  }
  const expected = new Set(expectedPositions);
  const seen = new Set<number>();
  const result: EditorOutputTheme[] = [];
  for (const t of themesField) {
    if (!t || typeof t !== "object") {
      throw new Error("a theme entry is not an object");
    }
    const tt = t as Record<string, unknown>;
    if (typeof tt.position !== "number" || !Number.isInteger(tt.position)) {
      throw new Error("theme.position must be an integer");
    }
    if (!expected.has(tt.position)) {
      throw new Error(
        `theme.position ${tt.position} not in expected set [${expectedPositions.join(", ")}]`,
      );
    }
    if (seen.has(tt.position)) {
      throw new Error(`theme.position ${tt.position} appears twice`);
    }
    seen.add(tt.position);
    if (typeof tt.editor_final !== "string" || tt.editor_final.trim().length === 0) {
      throw new Error(
        `theme.editor_final must be a non-empty string at position ${tt.position}`,
      );
    }
    result.push({ position: tt.position, editor_final: tt.editor_final });
  }
  return { themes: result };
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
      `[editor] no digest in status ${ALLOWED_START_STATUSES.join("/")} — run pnpm writer first`,
    );
    process.exit(1);
  }

  const today = digest.date;
  const systemPrompt = readFileSync(
    path.join(process.cwd(), "prompts/editor.md"),
    "utf8",
  );
  console.log(`[editor] digest_date=${today}`);

  const startedAt = new Date();
  let rawText = "";
  let parsed: unknown = null;
  let tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let costCents = 0;
  let inputJson: Json = { themes: [], target_word_count: TARGET_WORD_COUNT } as unknown as Json;

  try {
    const { error: setErr } = await supabase
      .from("digests")
      .update({ status: "editing", error: null })
      .eq("date", today);
    if (setErr) throw new Error(`set editing failed: ${setErr.message}`);

    // Re-run hygiene: clear all editor_final values for this digest before the
    // call. Mirrors Theme's "delete prior themes rows" pattern. Prompt
    // iteration just runs `pnpm editor` again.
    const { error: clearErr } = await supabase
      .from("themes")
      .update({ editor_final: null })
      .eq("digest_date", today);
    if (clearErr) throw new Error(`clear editor_final failed: ${clearErr.message}`);

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
      if (t.writer_draft === null) {
        throw new Error(
          `theme position=${t.position} has no writer_draft — run pnpm writer first`,
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

    const inputThemes: EditorInputTheme[] = themes.map((theme) => {
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

      const cited_tweets: CitedTweet[] = ranked.map((t, i) => ({
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
        writer_draft: theme.writer_draft as string,
        cited_tweets,
      };
    });

    const input: EditorInput = {
      themes: inputThemes,
      target_word_count: TARGET_WORD_COUNT,
    };
    inputJson = input as unknown as Json;

    console.log(
      `[editor] polishing ${inputThemes.length} themes via ${MODEL} (adaptive thinking, effort=high)…`,
    );

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // On Opus 4.7, thinking.display defaults to "omitted" — set "summarized"
      // explicitly so thinking blocks are surfaced in the response. `effort`
      // lives on output_config (separate from thinking) per the SDK 0.92 types
      // and Anthropic's adaptive-thinking docs.
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
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
      throw new EditorParseError(rawText, "no text block in response");
    }

    parsed = parseEditorOutput(rawText);
    const expectedPositions = inputThemes.map((t) => t.position);
    const out = validateEditorOutput(parsed, expectedPositions);

    for (const finalTheme of out.themes) {
      const { error: updErr } = await supabase
        .from("themes")
        .update({ editor_final: finalTheme.editor_final })
        .eq("digest_date", today)
        .eq("position", finalTheme.position);
      if (updErr) {
        throw new Error(
          `themes editor_final update failed at position ${finalTheme.position}: ${updErr.message}`,
        );
      }
    }

    const completedAt = new Date();

    const { error: runErr } = await supabase.from("agent_runs").insert({
      digest_date: today,
      theme_id: null,
      agent: "editor",
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
        status: "evaluating",
        total_input_tokens: newInputTotal,
        total_output_tokens: newOutputTotal,
        total_cost_cents: newCostTotal,
        error: null,
      })
      .eq("date", today);
    if (doneErr) throw new Error(`status -> evaluating failed: ${doneErr.message}`);

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    const costDollars = (costCents / 100).toFixed(4);
    const draftByPosition = new Map(
      inputThemes.map((t) => [t.position, t.writer_draft]),
    );
    const titleByPosition = new Map(
      inputThemes.map((t) => [t.position, t.title]),
    );

    console.log(
      `[editor] themes=${out.themes.length} | ` +
        `tokens in=${tokens.input} out=${tokens.output} cache_r=${tokens.cacheRead} cache_w=${tokens.cacheCreation} | ` +
        `cost=$${costDollars} | elapsed=${elapsedSec}s | status=evaluating`,
    );
    for (const finalTheme of out.themes) {
      const writerDraft = draftByPosition.get(finalTheme.position) ?? "";
      const title = titleByPosition.get(finalTheme.position) ?? "";
      const changedFlag = finalTheme.editor_final === writerDraft ? "unchanged" : "polished";
      console.log(
        `[editor]   ${finalTheme.position}. ${title} (${wordCount(finalTheme.editor_final)} words, ${changedFlag})`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase.from("agent_runs").insert({
        digest_date: today,
        theme_id: null,
        agent: "editor",
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
      console.error("[editor] failed to record agent_run failure:", recordErr);
    }
    try {
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
    } catch (recordErr) {
      console.error("[editor] failed to record digest failure:", recordErr);
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
