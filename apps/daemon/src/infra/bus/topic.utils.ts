/** True when a subscription key (`chat:*`, `global`, `repo:repo_…`) covers `topic`. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith(":*")) return topic.startsWith(pattern.slice(0, -1));
  return false;
}
