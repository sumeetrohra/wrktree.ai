import type { TGitStatus, TPullRequest } from "@agentdeck/protocol";
import { CircleAlert } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

import type { TShipAction } from "../api/ship.queries";

export type TShipSheetProps = {
  status: TGitStatus | undefined;
  /** undefined while loading or unavailable; null: no PR yet. */
  pr: TPullRequest | null | undefined;
  /** Why the PR state can't be read (e.g. `gh` isn't signed in). */
  prError: string | null;
  busy: boolean;
  error: string | null;
  /** False when the worktree has no chat to ask for a draft. */
  canDraft: boolean;
  drafting: boolean;
  onAction: (action: TShipAction) => void;
  onDraft: () => Promise<{ title: string; body: string }>;
};

/**
 * Ship a worktree from the phone: status, commit, push, a PR the agent drafts, merge. Without a
 * remote, merge into the base branch instead.
 */
export function ShipSheet({
  status,
  pr,
  prError,
  busy,
  error,
  canDraft,
  drafting,
  onAction,
  onDraft,
}: TShipSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  if (!status) return <Text className="text-muted-foreground p-4">{t("ship.loading")}</Text>;
  const unpushed = status.upstream === null || status.ahead > 0;
  return (
    <View className="border-border bg-card gap-3 border-b p-4">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-mono font-medium">{status.branch}</Text>
        <Badge variant="outline">
          <Text>{t("ship.dirty", { count: status.dirty })}</Text>
        </Badge>
        <Badge variant="outline">
          <Text>{t("ship.ahead", { count: status.ahead })}</Text>
        </Badge>
        {status.lastCommit ? (
          <Text className="text-muted-foreground flex-1 text-xs" numberOfLines={1}>
            {status.lastCommit.subject}
          </Text>
        ) : null}
      </View>

      {status.dirty > 0 ? (
        <View className="gap-2">
          <Textarea placeholder={t("ship.messagePlaceholder")} value={message} onChangeText={setMessage} />
          <Button
            disabled={busy || message.trim() === ""}
            onPress={() => {
              onAction({ kind: "commit", message });
              setMessage("");
            }}
          >
            <Text>{t("ship.commit")}</Text>
          </Button>
        </View>
      ) : null}

      {status.hasRemote ? (
        <>
          {unpushed ? (
            <Button
              variant="outline"
              disabled={busy || status.dirty > 0}
              onPress={() => {
                onAction({ kind: "push" });
              }}
            >
              <Text>{t("ship.push")}</Text>
            </Button>
          ) : null}
          {prError ? <Text className="text-destructive text-sm">{prError}</Text> : null}
          {pr === null && !unpushed ? (
            <View className="gap-2">
              <Button
                variant="secondary"
                disabled={!canDraft || drafting}
                onPress={() => {
                  void onDraft().then((d) => {
                    setTitle(d.title);
                    setBody(d.body);
                  });
                }}
              >
                <Text>{drafting ? t("ship.drafting") : t("ship.draftWithAgent")}</Text>
              </Button>
              <Input placeholder={t("ship.titlePlaceholder")} value={title} onChangeText={setTitle} />
              <Textarea placeholder={t("ship.bodyPlaceholder")} value={body} onChangeText={setBody} />
              <View className="flex-row gap-2">
                <Button
                  variant={draft ? "secondary" : "outline"}
                  onPress={() => {
                    setDraft(!draft);
                  }}
                >
                  <Text>{draft ? t("ship.asDraft") : t("ship.readyForReview")}</Text>
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy || title.trim() === ""}
                  onPress={() => {
                    onAction({ kind: "createPr", title, body, draft });
                  }}
                >
                  <Text>{t("ship.createPr")}</Text>
                </Button>
              </View>
            </View>
          ) : null}
          {pr ? (
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <Button
                  variant="link"
                  className="px-0"
                  onPress={() => {
                    void Linking.openURL(pr.url);
                  }}
                >
                  <Text>{t("ship.prNumber", { number: pr.number })}</Text>
                </Button>
                <Badge variant={pr.state === "merged" ? "default" : "outline"}>
                  <Text>
                    {t(`ship.prState.${pr.state}`)}
                    {pr.draft ? ` · ${t("ship.draftBadge")}` : ""}
                  </Text>
                </Badge>
              </View>
              {pr.state === "open" ? (
                <Button
                  disabled={busy || pr.draft}
                  onPress={() => {
                    onAction({ kind: "mergePr", method: "squash" });
                  }}
                >
                  <Text>{t("ship.mergePr")}</Text>
                </Button>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <Button
          variant="outline"
          disabled={busy || status.dirty > 0 || status.ahead === 0}
          onPress={() => {
            onAction({ kind: "mergeToBase" });
          }}
        >
          <Text>{t("ship.mergeToBase")}</Text>
        </Button>
      )}

      {error ? (
        <Alert variant="destructive" icon={CircleAlert}>
          <AlertTitle>{t("ship.failed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </View>
  );
}
