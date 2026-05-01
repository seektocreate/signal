import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database, DigestStatus } from "@/lib/db/types";
import { todayInPT } from "@/lib/util/date";
import { filterTweet } from "@/lib/agents/scout";

const COST_CEILING_CENTS = 100;
const ALLOWED_START_STATUSES: DigestStatus[] = ["pending", "scraping", "filtering"];

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

async function main() {
  const today = todayInPT();
  const start = Date.now();
  console.log(`[scout] digest_date=${today} (America/Los_Angeles)`);

  const { data: digest, error: digestErr } = await supabase
    .from("digests")
    .select("*")
    .eq("date", today)
    .maybeSingle();
  if (digestErr) throw new Error(`digest read failed: ${digestErr.message}`);
  if (!digest) throw new Error(`no digest row for ${today} — run pnpm scrape first`);

  if (!ALLOWED_START_STATUSES.includes(digest.status)) {
    console.error(
      `[scout] digest status is '${digest.status}'; refusing to re-filter. ` +
        `Allowed: ${ALLOWED_START_STATUSES.join(", ")}.`,
    );
    process.exit(1);
  }

  const systemPrompt = readFileSync(
    path.join(process.cwd(), "prompts/scout.md"),
    "utf8",
  );

  try {
    const { error: setFilterErr } = await supabase
      .from("digests")
      .update({ status: "filtering", error: null })
      .eq("date", today);
    if (setFilterErr) throw new Error(`set filtering failed: ${setFilterErr.message}`);

    const { data: tweets, error: tweetsErr } = await supabase
      .from("tweets")
      .select("*")
      .eq("digest_date", today)
      .is("kept", null)
      .order("posted_at", { ascending: false });
    if (tweetsErr) throw new Error(`tweets read failed: ${tweetsErr.message}`);

    if (!tweets || tweets.length === 0) {
      // Idempotent re-run case: nothing to do, but advance status if we're still
      // in 'filtering' so the pipeline can move on.
      const { error: pendingErr } = await supabase
        .from("digests")
        .update({ status: "theming" })
        .eq("date", today);
      if (pendingErr) throw new Error(`status -> theming failed: ${pendingErr.message}`);
      console.log("[scout] nothing to filter (all tweets already have kept set). status=theming");
      return;
    }

    console.log(`[scout] filtering ${tweets.length} tweets…`);

    let kept = 0;
    let dropped = 0;
    let failed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let costCents = 0;
    const sampleReasons: string[] = [];

    for (const tweet of tweets) {
      try {
        const result = await filterTweet({ supabase, anthropic, systemPrompt, tweet });
        if (result.decision.keep) kept++;
        else dropped++;
        inputTokens += result.tokens.input;
        outputTokens += result.tokens.output;
        cacheReadTokens += result.tokens.cacheRead;
        cacheCreationTokens += result.tokens.cacheCreation;
        costCents += result.costCents;
        if (result.decision.keep && sampleReasons.length < 5) {
          sampleReasons.push(result.decision.reason);
        }
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[scout] tweet @${tweet.author_handle} id=${tweet.x_tweet_id} failed: ${message}`,
        );
      }

      if (costCents > COST_CEILING_CENTS) {
        throw new Error(
          `cost ceiling hit: $${(costCents / 100).toFixed(4)} > $${(COST_CEILING_CENTS / 100).toFixed(2)}`,
        );
      }
    }

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
    const costDollars = (costCents / 100).toFixed(4);

    const tooManyFailures = failed > tweets.length / 2;
    if (tooManyFailures) {
      const message = `too many failures: ${failed}/${tweets.length}`;
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
      console.error(`[scout] ${message}`);
      throw new Error(message);
    }

    const newInputTotal = digest.total_input_tokens + inputTokens;
    const newOutputTotal = digest.total_output_tokens + outputTokens;
    const newCostTotal = digest.total_cost_cents + Math.round(costCents);

    const { error: doneErr } = await supabase
      .from("digests")
      .update({
        status: "theming",
        total_input_tokens: newInputTotal,
        total_output_tokens: newOutputTotal,
        total_cost_cents: newCostTotal,
        error: null,
      })
      .eq("date", today);
    if (doneErr) throw new Error(`status -> theming failed: ${doneErr.message}`);

    console.log(
      `[scout] tweets=${tweets.length} kept=${kept} dropped=${dropped} failed=${failed} | ` +
        `tokens in=${inputTokens} out=${outputTokens} cache_r=${cacheReadTokens} cache_w=${cacheCreationTokens} | ` +
        `cost=$${costDollars} | elapsed=${elapsedSec}s`,
    );
    if (sampleReasons.length > 0) {
      console.log(`[scout] sample reasons: ${sampleReasons.map((r) => `"${r}"`).join(", ")}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
    } catch (recordErr) {
      console.error("[scout] failed to record digest failure:", recordErr);
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
