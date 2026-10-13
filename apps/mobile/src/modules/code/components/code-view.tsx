import { FlashList } from "@shopify/flash-list";

import type { TTokenLines } from "@/lib/highlight";

import type { TLineRange } from "../utils/selection.utils";
import { extendRange, inRange } from "../utils/selection.utils";

import { CodeLine } from "./code-line";

export type TCodeViewProps = {
  lines: readonly string[];
  tokens?: TTokenLines | null | undefined;
  /** 1-based line to open at (search results, links). */
  focusLine?: number | undefined;
  selection: TLineRange | null;
  /** Tap selects one line; long-press extends the selection to that line; tap again clears. */
  onSelect: (range: TLineRange | null) => void;
};

/** A file as virtualized rows: only the lines on screen render, so long files scroll smoothly. */
export function CodeView({
  lines,
  tokens,
  focusLine,
  selection,
  onSelect,
}: TCodeViewProps): React.JSX.Element {
  return (
    <FlashList
      data={lines}
      keyExtractor={(_, i) => String(i)}
      initialScrollIndex={focusLine ? Math.max(0, focusLine - 1) : undefined}
      renderItem={({ item, index }) => {
        const line = index + 1;
        return (
          <CodeLine
            number={line}
            text={item}
            tokens={tokens?.[index]}
            selected={inRange(selection, line) || (selection === null && focusLine === line)}
            onPress={() => {
              onSelect(
                selection?.line === line && selection.endLine === line ? null : { line, endLine: line },
              );
            }}
            onLongPress={() => {
              onSelect(extendRange(selection, line));
            }}
          />
        );
      }}
    />
  );
}
