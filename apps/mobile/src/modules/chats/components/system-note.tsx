import { Text } from "@/shared/components/ui/text";

export type TSystemNoteProps = { text: string; level: "info" | "warn" | "error" };

/** A note from the daemon (restarts, limits, crashes). */
export function SystemNote({ text, level }: TSystemNoteProps): React.JSX.Element {
  return (
    <Text
      variant="small"
      className={level === "error" ? "text-destructive text-center" : "text-muted-foreground text-center"}
    >
      {text}
    </Text>
  );
}
