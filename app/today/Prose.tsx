import { Fragment } from "react";

const ALLOWED_TOKEN_PATTERN = /(\*\*[^*]+\*\*)/g;
const SUSPICIOUS_PATTERN = /(\*(?!\*)|_|`|^>|^#|^\s*[-*]\s|\[[^\]]*\]\()/m;

function warnIfUnexpectedMarkdown(input: string) {
  const cleaned = input.replace(/\*\*[^*]+\*\*/g, "");
  if (SUSPICIOUS_PATTERN.test(cleaned)) {
    console.warn(
      "[Prose] editor_final contains markdown beyond the \\n\\n + **bold** contract; rendering raw text. Sample:",
      cleaned.slice(0, 200),
    );
  }
}

function renderInline(text: string) {
  const parts = text.split(ALLOWED_TOKEN_PATTERN);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Prose({
  source,
  size = "lg",
}: {
  source: string;
  size?: "lg" | "sm";
}) {
  warnIfUnexpectedMarkdown(source);
  const paragraphs = source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sizing =
    size === "sm"
      ? "text-[14px] leading-[1.5]"
      : "text-body-lg leading-[1.6]";
  return (
    <div className={`space-y-default ${sizing}`}>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p)}</p>
      ))}
    </div>
  );
}
