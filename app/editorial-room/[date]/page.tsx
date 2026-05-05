import "server-only";
import { notFound } from "next/navigation";
import { getEditorialRoomData } from "@/lib/editorial-room";
import { AnchorNav } from "./AnchorNav";
import { DraftsSection } from "./DraftsSection";
import { EvalSection } from "./EvalSection";
import { Header } from "./Header";
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
        <ScoutSection data={data} />
        <ThemesSection data={data} />
        <DraftsSection data={data} />
        <EvalSection data={data} />
        <PipelineSection data={data} />
      </div>
    </main>
  );
}
