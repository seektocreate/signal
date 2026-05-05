import { Prose } from "@/app/today/Prose";
import type {
  EditorialRoomCitation,
  EditorialRoomTheme,
  EditorialRoomViewModel,
} from "@/lib/editorial-room";

const SCROLL_OFFSET = { scrollMarginTop: "56px" } as const;

function CitationRow({ citation }: { citation: EditorialRoomCitation }) {
  return (
    <li className="flex gap-default border-b border-chalk py-tight">
      <span className="w-[24px] shrink-0 font-mono text-[13px] text-slate tabular-nums">
        {citation.position}
      </span>
      <span className="w-[80px] shrink-0 text-caption text-gravel">{citation.role}</span>
      <span className="w-[140px] shrink-0 text-[14px]">
        <a
          href={citation.tweet.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-citation underline underline-offset-2"
        >
          @{citation.tweet.author_handle}
        </a>
      </span>
      <span className="text-[14px] text-cinder">{citation.tweet.text}</span>
    </li>
  );
}

function ThemeBlock({ theme }: { theme: EditorialRoomTheme }) {
  return (
    <article className="space-y-default">
      <div>
        <p className="mb-tight text-caption text-gravel">Theme {theme.position}</p>
        <h3 className="font-serif text-[18px] font-light leading-[1.3] tracking-[-0.01em] text-obsidian">
          {theme.title}
        </h3>
        <p className="mt-tight text-[14px] leading-[1.5] text-gravel">
          {theme.summary}
        </p>
      </div>

      <Prose source={theme.editor_final} size="sm" />

      <div className="space-y-tight">
        <p className="text-caption text-gravel">
          Citations ({theme.citations.length})
        </p>
        <ul className="border-t border-chalk">
          {theme.citations.map((c) => (
            <CitationRow key={`${theme.id}-${c.position}`} citation={c} />
          ))}
        </ul>
      </div>
    </article>
  );
}

export function ThemesSection({ data }: { data: EditorialRoomViewModel }) {
  return (
    <section id="themes" style={SCROLL_OFFSET} className="space-y-section">
      {data.themes.map((t) => (
        <ThemeBlock key={t.id} theme={t} />
      ))}
    </section>
  );
}
