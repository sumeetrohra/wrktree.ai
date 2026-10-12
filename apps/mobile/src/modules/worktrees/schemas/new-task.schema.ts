import { z } from "zod";

/** The new-task form. The branch name is derived from the title. */
export const newTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1),
  profileId: z.string().min(1),
  /** Optional: the model to ask the agent for; empty means its default. */
  model: z.string().trim().max(100).optional(),
});
export type TNewTask = z.infer<typeof newTaskSchema>;

/** "Fix the login bug" → "fix-the-login-bug" (never starting with "-": SEC5). */
export function branchFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug.length > 0 ? `task/${slug}` : "task/untitled";
}
