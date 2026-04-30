import type { Json } from "@/lib/db/types";

const ACTOR = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";
const API_BASE = "https://api.apify.com/v2";

export type ApifyTweet = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  author: {
    userName: string;
    name?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ScrapedTweet = {
  x_tweet_id: string;
  author_handle: string;
  author_name: string | null;
  text: string;
  posted_at: string;
  url: string;
  raw_json: Json;
};

export type ScrapeResult = {
  tweets: ScrapedTweet[];
  failedHandles: { handle: string; error: string }[];
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function isApifyTweet(x: unknown): x is ApifyTweet {
  if (!x || typeof x !== "object") return false;
  const t = x as Record<string, unknown>;
  const author = t.author as Record<string, unknown> | undefined;
  return (
    typeof t.id === "string" &&
    typeof t.url === "string" &&
    typeof t.text === "string" &&
    typeof t.createdAt === "string" &&
    !!author &&
    typeof author.userName === "string"
  );
}

function mapTweet(t: ApifyTweet): ScrapedTweet | null {
  const posted = new Date(t.createdAt);
  if (Number.isNaN(posted.getTime())) return null;
  const name = typeof t.author.name === "string" ? t.author.name : null;
  return {
    x_tweet_id: t.id,
    author_handle: t.author.userName,
    author_name: name,
    text: t.text,
    posted_at: posted.toISOString(),
    url: t.url,
    raw_json: t as unknown as Json,
  };
}

async function scrapeOneHandle({
  token,
  handle,
  perHandle,
}: {
  token: string;
  handle: string;
  perHandle: number;
}): Promise<ScrapedTweet[]> {
  const res = await fetch(`${API_BASE}/acts/${ACTOR}/run-sync-get-dataset-items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: handle,
      maxItems: perHandle,
      queryType: "Latest",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }

  const items = (await res.json()) as unknown;
  if (!Array.isArray(items)) {
    throw new Error(`actor returned non-array body: ${typeof items}`);
  }

  const tweets: ScrapedTweet[] = [];
  for (const item of items) {
    if (!isApifyTweet(item)) continue;
    const mapped = mapTweet(item);
    if (mapped) tweets.push(mapped);
  }
  return tweets;
}

export async function scrapeListTweets({
  handles,
  maxItems,
}: {
  handles: readonly string[];
  maxItems: number;
}): Promise<ScrapeResult> {
  const token = requireEnv("APIFY_API_TOKEN");
  if (handles.length === 0) throw new Error("scrapeListTweets: handles must be non-empty");

  const perHandle = Math.max(1, Math.floor(maxItems / handles.length));

  const tweets: ScrapedTweet[] = [];
  const failedHandles: { handle: string; error: string }[] = [];

  for (const handle of handles) {
    try {
      const handleTweets = await scrapeOneHandle({ token, handle, perHandle });
      tweets.push(...handleTweets);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[apify] handle @${handle} failed: ${message}`);
      failedHandles.push({ handle, error: message });
    }
  }

  return { tweets, failedHandles };
}
