import { getLatestPublishedDigest, type CitationView } from "@/lib/digest";
import { Prose } from "./Prose";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDigestDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

function CitationFooter({ citations }: { citations: CitationView[] }) {
  // De-dupe by author_handle, preserving first occurrence by
  // theme_citations.position. Each unique handle links to the URL of its
  // first cited tweet. No count annotation, no cap — single-author themes
  // (e.g. trial coverage) correctly shrink to one handle.
  const seen = new Set<string>();
  const unique: CitationView[] = [];
  for (const c of citations) {
    if (seen.has(c.author_handle)) continue;
    seen.add(c.author_handle);
    unique.push(c);
  }
  if (unique.length === 0) return null;
  return (
    <p className="mt-default text-caption leading-[1.4] text-gravel">
      {unique.map((c, i) => (
        <span key={c.author_handle}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-citation underline underline-offset-2"
          >
            @{c.author_handle}
          </a>
        </span>
      ))}
    </p>
  );
}

export default async function TodayPage() {
  const digest = await getLatestPublishedDigest();

  return (
    <main className="px-[24px] py-section">
      {digest === null ? (
        <div className="mx-auto max-w-[var(--measure-prose)] text-body text-gravel">
          No published digest yet.
        </div>
      ) : (
        <>
          <header className="mx-auto mb-section max-w-[var(--measure-display)]">
            <p className="mb-tight text-[14px] leading-[1.4] text-gravel">
              Signal — Today
            </p>
            <h1 className="font-serif font-light text-display leading-[1.1] tracking-[-0.02em] text-obsidian">
              {formatDigestDate(digest.digest_date)}
            </h1>
          </header>

          <article className="mx-auto max-w-[var(--measure-prose)] space-y-section">
            {digest.themes.map((theme) => (
              <section key={theme.position}>
                <p className="mb-tight text-[14px] leading-[1.4] text-gravel">
                  Theme {theme.position}
                </p>
                <h2 className="mb-default font-serif font-light text-heading leading-[1.3] tracking-[-0.01em] text-obsidian">
                  {theme.title}
                </h2>
                <Prose source={theme.editor_final} />
                <CitationFooter citations={theme.citations} />
              </section>
            ))}
          </article>
        </>
      )}
    </main>
  );
}
