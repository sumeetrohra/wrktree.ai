import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

import { compareFormSchema, toggleProfile, type TCompareForm } from "../schemas/compare.schema";

export type TCompareFormProps = {
  profiles: readonly { id: string; name: string; agent: string }[];
  busy: boolean;
  onSubmit: (v: TCompareForm) => void;
};

/** One task for 2–4 profiles: title, prompt, and who works on it. */
export function CompareForm({ profiles, busy, onSubmit }: TCompareFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const form = useForm<TCompareForm>({
    resolver: zodResolver(compareFormSchema),
    defaultValues: { title: "", prompt: "", profileIds: profiles.slice(0, 2).map((p) => p.id) },
  });
  const picked = form.watch("profileIds");
  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Label nativeID="compare-title">{t("newTask.title")}</Label>
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => (
            <Input
              aria-labelledby="compare-title"
              placeholder={t("newTask.titlePlaceholder")}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
      </View>
      <View className="gap-1.5">
        <Label nativeID="compare-prompt">{t("newTask.message")}</Label>
        <Controller
          control={form.control}
          name="prompt"
          render={({ field }) => (
            <Textarea
              aria-labelledby="compare-prompt"
              placeholder={t("newTask.messagePlaceholder")}
              value={field.value}
              onChangeText={field.onChange}
            />
          )}
        />
      </View>
      <View className="gap-1.5">
        <Label nativeID="compare-profiles">{t("compare.profiles")}</Label>
        <View className="flex-row flex-wrap gap-2" aria-labelledby="compare-profiles">
          {profiles.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={picked.includes(p.id) ? "default" : "outline"}
              onPress={() => {
                form.setValue("profileIds", toggleProfile(picked, p.id));
              }}
            >
              <Text>{t("newTask.profileOption", { name: p.name, agent: p.agent })}</Text>
            </Button>
          ))}
        </View>
        {form.formState.errors.profileIds ? (
          <Text className="text-destructive text-sm">{t("compare.pickTwo")}</Text>
        ) : null}
      </View>
      <Button
        disabled={busy}
        onPress={() => {
          void form.handleSubmit(onSubmit)();
        }}
      >
        <Text>{busy ? t("newTask.starting") : t("compare.start", { n: picked.length })}</Text>
      </Button>
    </View>
  );
}
