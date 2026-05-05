import type {
  EditorialRoomStageMetrics,
  EditorialRoomViewModel,
} from "@/lib/editorial-room";
import { formatCostCents, formatDuration, formatTokens } from "./format";

const SCROLL_OFFSET = { scrollMarginTop: "56px" } as const;
const COST_GAP_THRESHOLD_CENTS = 0.01;

function StageRow({ stage }: { stage: EditorialRoomStageMetrics }) {
  return (
    <tr className="border-b border-chalk align-top">
      <td className="px-tight py-tight text-[14px] text-obsidian">{stage.agent}</td>
      <td className="px-tight py-tight font-mono text-[13px] text-cinder">
        {stage.models.join(", ")}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {stage.total_runs}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {stage.failed_runs > 0 ? stage.failed_runs : "—"}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatDuration(stage.wall_clock_ms)}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatTokens(stage.input_tokens)}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatTokens(stage.output_tokens)}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatTokens(stage.cache_read_tokens)}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatTokens(stage.cache_creation_tokens)}
      </td>
      <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {formatCostCents(stage.cost_cents)}
      </td>
    </tr>
  );
}

export function PipelineSection({ data }: { data: EditorialRoomViewModel }) {
  const runs = data.runs;
  const gap = runs.total_cost_cents - runs.digest_total_cost_cents;
  const showGap = Math.abs(gap) > COST_GAP_THRESHOLD_CENTS;

  return (
    <section id="pipeline" style={SCROLL_OFFSET} className="space-y-default">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-chalk text-left">
              <th className="px-tight py-tight text-caption font-medium text-gravel">Stage</th>
              <th className="px-tight py-tight text-caption font-medium text-gravel">Models</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Runs</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Failed</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Wall-clock</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Input tokens</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Output tokens</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Cache R</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Cache W</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.by_stage.map((s) => (
              <StageRow key={s.agent} stage={s} />
            ))}
            <tr className="align-top">
              <td className="px-tight py-tight text-[14px] font-medium text-obsidian">total</td>
              <td className="px-tight py-tight font-mono text-[13px] text-cinder">—</td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {runs.total_runs}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {runs.failed_runs > 0 ? runs.failed_runs : "—"}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
                —
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {formatTokens(runs.total_input_tokens)}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {formatTokens(runs.total_output_tokens)}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {formatTokens(runs.total_cache_read_tokens)}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {formatTokens(runs.total_cache_creation_tokens)}
              </td>
              <td className="px-tight py-tight text-right font-mono text-[13px] text-obsidian tabular-nums">
                {formatCostCents(runs.total_cost_cents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {showGap && (
        <p className="text-caption leading-[1.4] text-gravel">
          Cost gap of {gap.toFixed(2)}¢ — <span className="font-mono">digests.total_cost_cents</span> excludes failed-run rows, while the canonical total above sums every <span className="font-mono">agent_runs</span> row including retries. See <span className="font-mono">known-limitations.md</span> #2.
        </p>
      )}
    </section>
  );
}
