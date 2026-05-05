import { Prose } from "@/app/today/Prose";
import type {
  EditorialRoomTheme,
  EditorialRoomViewModel,
} from "@/lib/editorial-room";
import { DiffView } from "./DiffView";

const SCROLL_OFFSET = { scrollMarginTop: "56px" } as const;

function DraftBlock({ theme }: { theme: EditorialRoomTheme }) {
  const unchanged = theme.writer_draft === theme.editor_final;
  if (unchanged) {
    return (
      <article className="space-y-tight">
        <p className="text-caption text-gravel">
          Theme {theme.position} — unchanged
        </p>
        <Prose source={theme.editor_final} size="sm" />
      </article>
    );
  }
  return (
    <article className="space-y-default">
      <div className="space-y-tight">
        <p className="text-caption text-gravel">
          Theme {theme.position} — Editor&apos;s edit
        </p>
        <DiffView writer={theme.writer_draft} editor={theme.editor_final} />
      </div>
      <div className="space-y-tight">
        <p className="text-caption text-gravel">Final</p>
        <Prose source={theme.editor_final} size="sm" />
      </div>
    </article>
  );
}

export function DraftsSection({ data }: { data: EditorialRoomViewModel }) {
  return (
    <section id="drafts" style={SCROLL_OFFSET} className="space-y-section">
      {data.themes.map((t) => (
        <DraftBlock key={t.id} theme={t} />
      ))}
    </section>
  );
}
