import { Redirect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Platform, ScrollView } from "react-native";
import { z } from "zod";

import { useHostsStore } from "@/lib/api";
import { QrScanner } from "@/lib/camera";
import { codeFrom, LinkCodeForm, useApproveLinkMutation } from "@/modules/hosts";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ code: z.string().optional() });

/**
 * Link a computer: approve the code `agentdeck login` shows (typed, scanned from its QR code, or
 * pre-filled by its link). The computer then joins the account and shows up under Work.
 */
export function LinkPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { code } = paramsSchema.parse(useLocalSearchParams());
  const account = useHostsStore((s) => s.account);
  const approve = useApproveLinkMutation();
  if (account !== "signedIn") {
    return <Redirect href={{ pathname: "/sign-in" }} />;
  }
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Text variant="h3">{t("link.title")}</Text>
      <Text className="text-muted-foreground">{t("link.intro")}</Text>
      {approve.isSuccess ? (
        <Text className="font-medium">{t("link.done", { name: approve.data.name })}</Text>
      ) : (
        <>
          {Platform.OS === "web" ? null : (
            <QrScanner
              onScanned={(data) => {
                const scanned = codeFrom(data);
                if (scanned !== null && !approve.isPending) approve.mutate(scanned);
              }}
            />
          )}
          <LinkCodeForm
            initialCode={code ?? ""}
            busy={approve.isPending}
            error={approve.error ? t("link.failed", { reason: approve.error.message }) : null}
            onApprove={(c) => {
              approve.mutate(c);
            }}
          />
        </>
      )}
    </ScrollView>
  );
}
