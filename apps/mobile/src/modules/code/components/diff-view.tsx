import { FlashList } from "@shopify/flash-list";

import type { TTokenLines } from "@/lib/highlight";

import { newLineOf, type TDiffRow } from "../utils/diff.utils";
import { extendRange, inRange, type TLineRange } from "../utils/selection.utils";

import { CodeLine } from "./code-line";

export type TDiffViewProps = {
  rows: readonly TDiffRow[];
  /** Colors per row (row texts tokenized together, in order). */
  tokens?: TTokenLines | null | undefined;
  /** Selected lines of the file as it is now (added and unchanged lines). */
  selection: TLineRange | null;
  onSelect: (range: TLineRange | null) => void;
};

/** A file's diff as virtualized rows; tap or long-press added/unchanged lines to select them. */
export function DiffView({ rows, tokens, selection, onSelect }: TDiffViewProps): React.JSX.Element {
  return (
    <FlashList
      data={rows}
      keyExtractor={(_, i) => String(i)}
      getItemType={(r) => r.kind}
      renderItem={({ item, index }) => {
        const line = newLineOf(item);
        const number = item.kind === "del" ? item.oldNo : line;
        return (
          <CodeLine
            number={item.kind === "hunk" ? null : number}
            text={item.text}
            tokens={item.kind === "hunk" ? undefined : tokens?.[index]}
            tone={item.kind === "ctx" ? undefined : item.kind}
            selected={line !== null && inRange(selection, line)}
            onPress={
              line === null
                ? undefined
                : () => {
                    onSelect(
                      selection?.line === line && selection.endLine === line ? null : { line, endLine: line },
                    );
                  }
            }
            onLongPress={
              line === null
                ? undefined
                : () => {
                    onSelect(extendRange(selection, line));
                  }
            }
          />
        );
      }}
    />
  );
}
