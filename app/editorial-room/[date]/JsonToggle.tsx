"use client";
import { type ReactNode, useState } from "react";

export function JsonToggle({
  eyebrow,
  children,
  rawJson,
}: {
  eyebrow: string;
  children: ReactNode;
  rawJson: unknown;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="space-y-tight">
      <div className="flex items-center justify-between gap-default">
        <p className="text-caption leading-none text-gravel">{eyebrow}</p>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="tap-target translate-y-[1px] text-caption leading-none text-gravel underline underline-offset-2 hover:text-obsidian"
        >
          {showRaw ? "Show structured" : "Show raw"}
        </button>
      </div>
      {showRaw ? (
        <pre className="fade-right max-h-[600px] overflow-auto whitespace-pre rounded-card bg-powder p-default font-mono text-[13px] leading-[1.5] text-cinder shadow-hairline">
          {JSON.stringify(rawJson, null, 2)}
        </pre>
      ) : (
        children
      )}
    </div>
  );
}
