import type { EvalDimension } from "@/lib/db/types";

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatDimensionName(d: EvalDimension): string {
  switch (d) {
    case "signal_vs_noise":
      return "Signal vs noise";
    case "voice":
      return "Voice";
    case "brevity":
      return "Brevity";
    case "citation_honesty":
      return "Citation honesty";
    case "coverage":
      return "Coverage";
  }
}

export function formatCostCents(cents: number): string {
  return `${cents.toFixed(4)}¢`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDigestDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}
