import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TSearchResultRowProps = {
  match: { path: string; line: number; text: string };
  onOpen: (path: string, line: number) => void;
};

/** A ripgrep match: `path:line` and the matching line. */
export function SearchResultRow({ match, onOpen }: TSearchResultRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      className="h-auto flex-col items-start gap-0.5 px-3 py-2"
      onPress={() => {
        onOpen(match.path, match.line);
      }}
    >
      <Text className="text-muted-foreground font-mono text-xs">
        {t("files.at", { path: match.path, line: match.line })}
      </Text>
      <Text className="font-mono text-xs" numberOfLines={1}>
        {match.text.trim()}
      </Text>
    </Button>
  );
}
