import "server-only";
import { notFound } from "next/navigation";
import { getEditorialRoomData } from "@/lib/editorial-room";
import { AnchorNav } from "./AnchorNav";
import { DraftsSection } from "./DraftsSection";
import { EvalSection } from "./EvalSection";
import { Header } from "./Header";
import { JsonToggle } from "./JsonToggle";
import { PipelineSection } from "./PipelineSection";
import { ScoutSection } from "./ScoutSection";
import { ThemesSection } from "./ThemesSection";

export const dynamic = "force-dynamic";

export default async function EditorialRoomPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const data = await getEditorialRoomData(date);
  if (!data) notFound();

  return (
    <main className="min-h-full bg-eggshell">
      <Header data={data} />
      <AnchorNav />
      <div className="mx-auto max-w-[1280px] space-y-section px-default py-section">
        <JsonToggle
          eyebrow="Scout decisions"
          rawJson={{
            tweets: data.tweets,
            unthemed_kept_tweets: data.unthemed_kept_tweets,
          }}
        >
          <ScoutSection data={data} />
        </JsonToggle>
        <JsonToggle
          eyebrow={`Themes (${data.themes.length})`}
          rawJson={data.themes}
        >
          <ThemesSection data={data} />
        </JsonToggle>
        <JsonToggle
          eyebrow={`Writer / Editor drafts (${data.themes.length})`}
          rawJson={data.themes.map((t) => ({
            position: t.position,
            writer_draft: t.writer_draft,
            editor_final: t.editor_final,
          }))}
        >
          <DraftsSection data={data} />
        </JsonToggle>
        <JsonToggle
          eyebrow={`Eval — Run ${data.eval.run_index + 1} of ${data.eval.total_runs}`}
          rawJson={data.eval}
        >
          <EvalSection data={data} />
        </JsonToggle>
        <JsonToggle eyebrow="Pipeline" rawJson={data.runs}>
          <PipelineSection data={data} />
        </JsonToggle>
      </div>
    </main>
  );
}
