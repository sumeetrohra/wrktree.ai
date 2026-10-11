import type { TRepo } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";
import { fromNow } from "@/shared/utils/datetime-utils";

export type TRepoListProps = { repos: readonly TRepo[] };

/** Presentational list of repositories; data comes in through props (R5). */
export function RepoList({ repos }: TRepoListProps): React.JSX.Element {
  const { t } = useTranslation();
  if (repos.length === 0) {
    return <Text className="text-muted-foreground">{t("repos.empty")}</Text>;
  }
  return (
    <View className="gap-3">
      {repos.map((repo) => (
        <Card key={repo.id}>
          <CardHeader>
            <View className="flex-row items-center justify-between">
              <CardTitle>{repo.name}</CardTitle>
              <Badge variant="secondary">
                <Text>{t("repos.defaultBranch", { branch: repo.defaultBase })}</Text>
              </Badge>
            </View>
            <CardDescription>{t("repos.added", { when: fromNow(repo.createdAt) })}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </View>
  );
}
