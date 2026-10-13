import { z } from "zod";

/** The compare form: one task, 2–4 profiles. */
export const compareFormSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1),
  profileIds: z.array(z.string().min(1)).min(2).max(4),
});
export type TCompareForm = z.infer<typeof compareFormSchema>;

/** Adds or removes a profile, keeping the order picked and at most four. */
export function toggleProfile(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= 4 ? [...ids] : [...ids, id];
}
