import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { RepoList, useReposQuery } from "@/modules/repos";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

/** The repositories screen: decides the data and composes the repos module (S4). */
export function ReposPage(): React.JSX.Element {
  const { t } = useTranslation();
  const repos = useReposQuery();
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Text variant="h3">{t("repos.title")}</Text>
      {repos.isPending ? <Skeleton className="h-20 w-full" /> : null}
      {repos.isError ? (
        <Alert icon={CircleAlert} variant="destructive">
          <AlertTitle>{t("repos.loadFailed")}</AlertTitle>
          <AlertDescription>{repos.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {repos.isSuccess ? <RepoList repos={repos.data} /> : null}
    </ScrollView>
  );
}
