// Backend wraps matched terms in ⟪...⟫ (see backend/main.py's ts_headline
// StartSel/StopSel). Rendered as plain React text children throughout - no
// dangerouslySetInnerHTML - so this is safe even if transcript content
// itself contains HTML-looking text.
const START = "⟪";
const STOP = "⟫";

export function HighlightedSnippet({ text }: { text: string }) {
  const pieces = text.split(START);

  return (
    <>
      {pieces.map((piece, i) => {
        if (i === 0) return piece;
        const stopIndex = piece.indexOf(STOP);
        if (stopIndex === -1) return piece;
        const match = piece.slice(0, stopIndex);
        const rest = piece.slice(stopIndex + STOP.length);
        return (
          <span key={i}>
            <mark className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-400/40 dark:text-amber-100">
              {match}
            </mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}
