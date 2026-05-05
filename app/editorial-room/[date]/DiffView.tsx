import diff_match_patch from "diff-match-patch";

export function DiffView({
  writer,
  editor,
}: {
  writer: string;
  editor: string;
}) {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(writer, editor);
  dmp.diff_cleanupSemantic(diffs);
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-[1.5] text-cinder">
      {diffs.map(([op, text], i) => {
        if (op === diff_match_patch.DIFF_DELETE) {
          return (
            <span key={i} className="text-fog line-through">
              {text}
            </span>
          );
        }
        if (op === diff_match_patch.DIFF_INSERT) {
          return (
            <span key={i} className="text-cinder underline underline-offset-2">
              {text}
            </span>
          );
        }
        return <span key={i}>{text}</span>;
      })}
    </div>
  );
}
