import type { TChatItem, TChatItemPatch } from "@agentdeck/protocol";

/** Applies a streaming patch to the one field set its item kind has. Unknown fields are ignored. */
export function applyPatch(item: TChatItem, patch: TChatItemPatch): TChatItem {
  switch (item.kind) {
    case "agent_text":
    case "thought":
      return patch.text === undefined ? item : { ...item, text: patch.text };
    case "tool":
      return {
        ...item,
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.locations === undefined ? {} : { locations: patch.locations }),
      };
    case "plan":
      return patch.entries === undefined ? item : { ...item, entries: patch.entries };
    case "user":
    case "system":
      return item;
  }
}
