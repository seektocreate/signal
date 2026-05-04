import "server-only";
import { supabase } from "@/lib/db/client";

export type CitationView = {
  position: number;
  author_handle: string;
  url: string;
};

export type ThemeView = {
  position: number;
  title: string;
  editor_final: string;
  citations: CitationView[];
};

export type DigestView = {
  digest_date: string;
  themes: ThemeView[];
};

export async function getLatestPublishedDigest(): Promise<DigestView | null> {
  const { data: digest, error: digestErr } = await supabase
    .from("digests")
    .select("date")
    .eq("status", "complete")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (digestErr) throw new Error(`digest read failed: ${digestErr.message}`);
  if (!digest) return null;

  const today = digest.date;

  const { data: themes, error: themesErr } = await supabase
    .from("themes")
    .select("id, position, title, editor_final")
    .eq("digest_date", today)
    .order("position", { ascending: true });
  if (themesErr) throw new Error(`themes read failed: ${themesErr.message}`);
  if (!themes || themes.length === 0) {
    throw new Error(`digest ${today} has no themes`);
  }
  for (const t of themes) {
    if (t.editor_final === null) {
      throw new Error(
        `theme position=${t.position} on ${today} has no editor_final`,
      );
    }
  }

  const themeIds = themes.map((t) => t.id);
  const { data: citations, error: citErr } = await supabase
    .from("theme_citations")
    .select("theme_id, tweet_id, position")
    .in("theme_id", themeIds)
    .order("position", { ascending: true });
  if (citErr) throw new Error(`theme_citations read failed: ${citErr.message}`);

  const tweetIds = Array.from(
    new Set((citations ?? []).map((c) => c.tweet_id)),
  );
  const tweetById = new Map<
    string,
    { author_handle: string; url: string }
  >();
  if (tweetIds.length > 0) {
    const { data: tweets, error: tweetsErr } = await supabase
      .from("tweets")
      .select("id, author_handle, url")
      .in("id", tweetIds);
    if (tweetsErr) throw new Error(`tweets read failed: ${tweetsErr.message}`);
    for (const tw of tweets ?? []) {
      tweetById.set(tw.id, {
        author_handle: tw.author_handle,
        url: tw.url,
      });
    }
  }

  const citationsByTheme = new Map<string, CitationView[]>();
  for (const c of citations ?? []) {
    const tweet = tweetById.get(c.tweet_id);
    if (!tweet) continue;
    const arr = citationsByTheme.get(c.theme_id) ?? [];
    arr.push({
      position: c.position,
      author_handle: tweet.author_handle,
      url: tweet.url,
    });
    citationsByTheme.set(c.theme_id, arr);
  }

  return {
    digest_date: today,
    themes: themes.map((t) => ({
      position: t.position,
      title: t.title,
      editor_final: t.editor_final as string,
      citations: citationsByTheme.get(t.id) ?? [],
    })),
  };
}
