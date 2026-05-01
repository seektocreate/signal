import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { scrapeListTweets } from "@/lib/scrapers/apify";
import { SIGNAL_HANDLES } from "@/lib/sources/handles";
import { todayInPT } from "@/lib/util/date";

// 1000 across ~52 handles ≈ 19/handle for a 72h window. The wrapper runs the
// actor once per handle and divides maxItems evenly. Some handles may post
// >19 times in 72h; the date filter trims rather than the per-handle cap.
const MAX_ITEMS = 1000;
const COST_PER_1K = 0.25;
const WINDOW_HOURS = 72;
const CROSS_DIGEST_LOOKBACK_DAYS = 7;

// Local Supabase client. lib/db/client.ts uses `server-only`, which throws when
// imported in plain Node — so the CLI script creates its own.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
}
const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function main() {
  const today = todayInPT();
  const startedIso = new Date().toISOString();
  const start = Date.now();

  console.log(`[ingest] digest_date=${today} (America/Los_Angeles)`);

  // Create digest row if missing — does not clobber an existing row's
  // started_at / token totals on re-run.
  const { error: upsertErr } = await supabase
    .from("digests")
    .upsert(
      { date: today, status: "scraping", started_at: startedIso },
      { onConflict: "date", ignoreDuplicates: true },
    );
  if (upsertErr) throw new Error(`digest upsert failed: ${upsertErr.message}`);

  // Reset to scraping (clears any prior 'failed' state for re-runs).
  const { error: statusErr } = await supabase
    .from("digests")
    .update({ status: "scraping", error: null })
    .eq("date", today);
  if (statusErr) throw new Error(`digest status reset failed: ${statusErr.message}`);

  try {
    const sinceTime = Math.floor((Date.now() - WINDOW_HOURS * 3600 * 1000) / 1000);
    const result = await scrapeListTweets({
      handles: SIGNAL_HANDLES,
      maxItems: MAX_ITEMS,
      sinceTime,
    });
    const scraped = result.tweets.length;

    if (result.failedHandles.length === SIGNAL_HANDLES.length) {
      throw new Error(
        `all ${SIGNAL_HANDLES.length} handles failed against kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`,
      );
    }

    // Cross-digest dedup: tweets kept in any digest within the lookback window
    // should not reappear in today's. The 72h scrape window overlaps the prior
    // 1–2 days, so without this the same tweet could be published twice.
    const lookbackDate = new Date();
    lookbackDate.setUTCDate(lookbackDate.getUTCDate() - CROSS_DIGEST_LOOKBACK_DAYS);
    const lookbackStr = lookbackDate.toISOString().slice(0, 10);
    const { data: priorRows, error: priorErr } = await supabase
      .from("tweets")
      .select("x_tweet_id")
      .gte("digest_date", lookbackStr)
      .eq("kept", true)
      .not("x_tweet_id", "is", null);
    if (priorErr) throw new Error(`prior-tweet lookup failed: ${priorErr.message}`);
    const priorIds = new Set((priorRows ?? []).map((r) => r.x_tweet_id));

    const freshTweets = result.tweets.filter((t) => !priorIds.has(t.x_tweet_id));
    const crossDigestDupes = scraped - freshTweets.length;

    let inserted = 0;
    if (freshTweets.length > 0) {
      const rows = freshTweets.map((t) => ({ digest_date: today, ...t }));
      const { data, error } = await supabase
        .from("tweets")
        .upsert(rows, {
          onConflict: "digest_date,x_tweet_id",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw new Error(`tweets upsert failed: ${error.message}`);
      inserted = data?.length ?? 0;
    }

    const withinDayDupes = freshTweets.length - inserted;
    const sampleHandles = Array.from(
      new Set(result.tweets.map((t) => t.author_handle)),
    ).slice(0, 5);
    const elapsedMs = Date.now() - start;
    const estCostUsd = (scraped / 1000) * COST_PER_1K;

    const { error: pendingErr } = await supabase
      .from("digests")
      .update({ status: "pending", error: null })
      .eq("date", today);
    if (pendingErr) throw new Error(`digest pending update failed: ${pendingErr.message}`);

    console.log(
      `[ingest] scraped=${scraped}, within-day-dupes=${withinDayDupes}, cross-digest-dupes=${crossDigestDupes}, inserted=${inserted}`,
    );
    console.log(
      `[ingest] sample handles: ${sampleHandles.map((h) => `@${h}`).join(", ") || "(none)"}`,
    );
    if (result.failedHandles.length > 0) {
      const list = result.failedHandles.map((f) => `@${f.handle}`).join(", ");
      console.log(`[ingest] failed handles (${result.failedHandles.length}): ${list}`);
    }
    console.log(`[ingest] elapsed=${elapsedMs}ms`);
    console.log(
      `[ingest] estimated apify cost: $${estCostUsd.toFixed(4)} (at $${COST_PER_1K.toFixed(2)}/1k tweets)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await supabase
        .from("digests")
        .update({ status: "failed", error: message })
        .eq("date", today);
    } catch (recordErr) {
      console.error("failed to record digest failure:", recordErr);
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
