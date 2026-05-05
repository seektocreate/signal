import type {
  EditorialRoomEvalDimension,
  EditorialRoomViewModel,
} from "@/lib/editorial-room";
import { formatDimensionName } from "./format";

const SCROLL_OFFSET = { scrollMarginTop: "56px" } as const;

function ScoreChip({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-pill bg-powder px-tight py-[4px] font-mono text-[13px] font-medium text-obsidian shadow-hairline tabular-nums"
      style={{ minWidth: "32px" }}
    >
      {score}
    </span>
  );
}

function DimensionRow({ dim }: { dim: EditorialRoomEvalDimension }) {
  return (
    <article className="space-y-tight border-b border-chalk py-default">
      <div className="flex items-center gap-default">
        <ScoreChip score={dim.score} />
        <h3 className="text-[14px] font-medium text-obsidian">
          {formatDimensionName(dim.dimension)}
        </h3>
      </div>
      <p className="text-[14px] leading-[1.5] text-cinder">{dim.reasoning}</p>
      {dim.issues.length > 0 && (
        <div className="space-y-tight pt-tight">
          <p className="text-caption text-gravel">Issues</p>
          <ul className="list-disc space-y-tight pl-default text-[14px] leading-[1.5] text-cinder">
            {dim.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {dim.suggestions.length > 0 && (
        <div className="space-y-tight pt-tight">
          <p className="text-caption text-gravel">Suggestions</p>
          <ul className="list-disc space-y-tight pl-default text-[14px] leading-[1.5] text-cinder">
            {dim.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function EvalSection({ data }: { data: EditorialRoomViewModel }) {
  return (
    <section id="eval" style={SCROLL_OFFSET} className="space-y-default">
      <div>
        {data.eval.dimensions.map((d) => (
          <DimensionRow key={d.dimension} dim={d} />
        ))}
      </div>
    </section>
  );
}
