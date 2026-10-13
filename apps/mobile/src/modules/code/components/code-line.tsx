import type { TToken } from "@/lib/highlight";
import { Text } from "@/shared/components/ui/text";
import { cn } from "@/shared/utils/cn.utils";

export type TCodeLineProps = {
  /** Shown in the gutter; null leaves it blank (e.g. a deleted line's new side). */
  number: number | null;
  text: string;
  tokens?: readonly TToken[] | undefined;
  /** Diff rows tint the line. */
  tone?: "add" | "del" | "hunk" | undefined;
  selected?: boolean;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
};

const TONE = {
  add: "bg-primary/10",
  del: "bg-destructive/15",
  hunk: "bg-muted text-muted-foreground",
} as const;

/** One monospace line: gutter number, then colored runs (or plain text). */
export function CodeLine({
  number,
  text,
  tokens,
  tone,
  selected = false,
  onPress,
  onLongPress,
}: TCodeLineProps): React.JSX.Element {
  return (
    <Text
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn(
        "px-2 font-mono text-xs leading-5",
        tone ? TONE[tone] : null,
        selected ? "bg-primary/20" : null,
      )}
      numberOfLines={1}
    >
      <Text className="text-muted-foreground font-mono text-xs">
        {(number === null ? "" : String(number)).padStart(5)}{" "}
      </Text>
      {tone === "add" ? "+" : tone === "del" ? "-" : tone === "hunk" ? "" : " "}
      {tokens && tokens.length > 0
        ? tokens.map((t, i) => (
            <Text key={i} className="font-mono text-xs" style={t.color ? { color: t.color } : undefined}>
              {t.content}
            </Text>
          ))
        : text}
    </Text>
  );
}
