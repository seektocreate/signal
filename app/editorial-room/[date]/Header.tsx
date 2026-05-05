import type { EditorialRoomViewModel } from "@/lib/editorial-room";
import { formatCostCents, formatDigestDate } from "./format";

export function Header({ data }: { data: EditorialRoomViewModel }) {
  return (
    <header className="border-b border-chalk px-default pt-section pb-default">
      <div className="mx-auto max-w-[1280px]">
        <p className="mb-tight text-caption text-gravel">Editorial Room</p>
        <h1 className="font-mono text-[32px] leading-[1.2] tracking-[-0.01em] text-obsidian">
          {data.digest_date}
        </h1>
        <p className="mt-tight text-caption text-gravel">
          {formatDigestDate(data.digest_date)}
        </p>
        <p className="mt-default flex flex-wrap items-baseline gap-tight text-caption text-gravel">
          <span>status</span>
          <span className="font-mono text-[13px] text-cinder">{data.status}</span>
          <span aria-hidden="true">·</span>
          <span>runs</span>
          <span className="font-mono text-[13px] text-cinder tabular-nums">
            {data.runs.total_runs}
          </span>
          <span aria-hidden="true">·</span>
          <span>cost</span>
          <span className="font-mono text-[13px] text-cinder tabular-nums">
            {formatCostCents(data.runs.total_cost_cents)}
          </span>
          <span aria-hidden="true">·</span>
          <span>tokens</span>
          <span className="font-mono text-[13px] text-cinder tabular-nums">
            {(data.runs.total_input_tokens + data.runs.total_output_tokens).toLocaleString("en-US")}
          </span>
        </p>
      </div>
    </header>
  );
}
