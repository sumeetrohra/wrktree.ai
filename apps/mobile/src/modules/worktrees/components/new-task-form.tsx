import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

import { newTaskSchema, type TNewTask } from "../schemas/new-task.schema";

export type TNewTaskFormProps = {
  profiles: readonly { id: string; name: string; agent: string }[];
  busy: boolean;
  onSubmit: (v: TNewTask) => void;
};

/** Title, first message and which profile runs it (spec: new-task flow). */
export function NewTaskForm({ profiles, busy, onSubmit }: TNewTaskFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const form = useForm<TNewTask>({
    resolver: zodResolver(newTaskSchema),
    defaultValues: { title: "", message: "", profileId: profiles[0]?.id ?? "", model: "" },
  });
  const profileId = form.watch("profileId");
  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Label nativeID="task-title">{t("newTask.title")}</Label>
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => (
            <Input
              aria-labelledby="task-title"
              placeholder={t("newTask.titlePlaceholder")}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
      </View>
      <View className="gap-1.5">
        <Label nativeID="task-message">{t("newTask.message")}</Label>
        <Controller
          control={form.control}
          name="message"
          render={({ field }) => (
            <Textarea
              aria-labelledby="task-message"
              placeholder={t("newTask.messagePlaceholder")}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
      </View>
      <View className="gap-1.5">
        <Label nativeID="task-profile">{t("newTask.profile")}</Label>
        <View className="flex-row flex-wrap gap-2" aria-labelledby="task-profile">
          {profiles.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.id === profileId ? "default" : "outline"}
              onPress={() => {
                form.setValue("profileId", p.id);
              }}
            >
              <Text>{t("newTask.profileOption", { name: p.name, agent: p.agent })}</Text>
            </Button>
          ))}
        </View>
      </View>
      <View className="gap-1.5">
        <Label nativeID="task-model">{t("newTask.model")}</Label>
        <Controller
          control={form.control}
          name="model"
          render={({ field }) => (
            <Input
              aria-labelledby="task-model"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("newTask.modelPlaceholder")}
              value={field.value ?? ""}
              onChangeText={field.onChange}
            />
          )}
        />
      </View>
      <Button
        disabled={busy}
        onPress={() => {
          void form.handleSubmit(onSubmit)();
        }}
      >
        <Text>{busy ? t("newTask.starting") : t("newTask.start")}</Text>
      </Button>
    </View>
  );
}
