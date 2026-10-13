import { Skeleton } from "@/shared/components/ui/skeleton";

import { useSaveInstructionsMutation, useSharedConfigQuery } from "../api/shared-config.queries";

import { SharedConfigEditor } from "./shared-config-editor";

/** One computer's shared config, loaded and saved. */
export function SharedConfigSection({ hostId }: { hostId: string }): React.JSX.Element {
  const config = useSharedConfigQuery(hostId);
  const save = useSaveInstructionsMutation(hostId);
  if (!config.data) return <Skeleton className="h-32" />;
  return (
    <SharedConfigEditor
      config={config.data}
      saving={save.isPending}
      saved={save.isSuccess}
      onSave={(instructions) => {
        save.mutate(instructions);
      }}
    />
  );
}
