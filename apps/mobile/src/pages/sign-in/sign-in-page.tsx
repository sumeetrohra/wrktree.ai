import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import { z } from "zod";

import { daemonCall, LOCAL_HOST, useHostsStore } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
  SignInForm,
  useCompleteSignInMutation,
  useDevSignInMutation,
  useSendLinkMutation,
} from "@/modules/auth";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ oobCode: z.string().optional(), relay: z.string().optional() });

/**
 * Sign in to see every computer on the account. Opened from the email link too (`?oobCode=…`), in
 * which case it finishes on its own once the user confirms. On the desktop web UI the relay comes
 * from this computer's daemon.
 */
export function SignInPage(): React.JSX.Element {
  const { t } = useTranslation();
  const params = paramsSchema.parse(useLocalSearchParams());
  const account = useHostsStore((s) => s.account);
  const hasLocal = useHostsStore((s) => s.hosts.some((h) => h.local));
  const localRelay = useQuery({
    queryKey: ["local-relay"],
    queryFn: async () => (await daemonCall(LOCAL_HOST, "relay.status", {})).url,
    enabled: hasLocal,
  });
  const send = useSendLinkMutation();
  const complete = useCompleteSignInMutation();
  const dev = useDevSignInMutation();
  if (account === "signedIn") return <Redirect href="/" />;
  if (hasLocal && localRelay.isPending) return <Skeleton className="m-4 h-40" />;
  const relayUrl = params.relay ?? localRelay.data ?? auth.defaultRelayUrl;
  const error = send.error ?? complete.error ?? dev.error;
  // Back to where sign-in was opened from, or home when it was the first screen.
  const done = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const pendingEmail = send.isSuccess ? send.variables.email : auth.pendingEmail();
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Text variant="h3">{t("auth.title")}</Text>
      <Text className="text-muted-foreground">{hasLocal ? t("auth.introLocal") : t("auth.intro")}</Text>
      <SignInForm
        methods={auth.methods}
        initialRelayUrl={relayUrl}
        pendingEmail={params.oobCode !== undefined ? (pendingEmail ?? "") : pendingEmail}
        initialLink={params.oobCode === undefined ? "" : `${relayUrl}/?oobCode=${params.oobCode}`}
        busy={send.isPending || complete.isPending || dev.isPending}
        error={error ? t("auth.failed", { reason: error.message }) : null}
        onSendLink={(email) => {
          send.mutate({ email });
        }}
        onCompleteLink={(relay, email, link) => {
          complete.mutate({ relayUrl: relay, email, link }, { onSuccess: done });
        }}
        onDevSignIn={(relay, uid) => {
          dev.mutate({ relayUrl: relay, uid }, { onSuccess: done });
        }}
      />
    </ScrollView>
  );
}
