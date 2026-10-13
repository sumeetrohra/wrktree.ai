import type { TTerminal } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { TerminalView } from "@/lib/terminal";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

import { terminalFeed } from "../stores/terminal.store";

import { KeyBar } from "./key-bar";

export type TTerminalPaneProps = {
  terminals: readonly TTerminal[];
  current: TTerminal | undefined;
  busy: boolean;
  onOpen: () => void;
  onShow: (term: TTerminal) => void;
  onClose: (term: TTerminal) => void;
  onInput: (termId: string, data: string) => void;
  onResize: (termId: string, cols: number, rows: number) => void;
};

/** The worktree's shells: a bar (each open terminal, new, close) over the one shown. */
export function TerminalPane({
  terminals,
  current,
  busy,
  onOpen,
  onShow,
  onClose,
  onInput,
  onResize,
}: TTerminalPaneProps): React.JSX.Element {
  const { t } = useTranslation();
  const running = terminals.filter((x) => x.status === "running");
  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-1 border-b px-2 py-2">
        {running.map((term, i) => (
          <Button
            key={term.id}
            size="sm"
            variant={term.id === current?.id ? "secondary" : "ghost"}
            onPress={() => {
              onShow(term);
            }}
          >
            <Text>{t("terminal.name", { n: i + 1 })}</Text>
          </Button>
        ))}
        <Button size="sm" variant="outline" disabled={busy} onPress={onOpen}>
          <Text>{t("terminal.new")}</Text>
        </Button>
        {current?.status === "running" ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              onClose(current);
            }}
          >
            <Text>{t("terminal.close")}</Text>
          </Button>
        ) : null}
      </View>
      {current ? (
        <>
          <View className="flex-1">
            <TerminalView
              key={current.id}
              feed={terminalFeed(current.id)}
              label={t("terminal.label")}
              onInput={(data) => {
                onInput(current.id, data);
              }}
              onResize={(cols, rows) => {
                onResize(current.id, cols, rows);
              }}
            />
          </View>
          {current.status === "exited" ? (
            <Text className="text-muted-foreground px-4 py-2 text-sm">{t("terminal.exited")}</Text>
          ) : (
            <KeyBar
              onKey={(data) => {
                onInput(current.id, data);
              }}
            />
          )}
        </>
      ) : (
        <Text className="text-muted-foreground p-4">{t("terminal.intro")}</Text>
      )}
    </View>
  );
}
