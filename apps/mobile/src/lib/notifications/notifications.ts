import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { z } from "zod";

const projectSchema = z.object({ eas: z.object({ projectId: z.string() }) });

/**
 * Asks for permission and returns this device's Expo push token, or null (denied, simulator, or no
 * EAS project configured yet). The relay sends a fixed, content-free wake-up to it.
 */
export async function registerForPush(): Promise<string | null> {
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return null;
  const project = projectSchema.safeParse(Constants.expoConfig?.extra);
  if (!project.success) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId: project.data.eas.projectId })).data;
  } catch {
    return null;
  }
}

/** Calls `fn` when the user taps a notification (the app then opens the chat that needs them). */
export function onNotificationTap(fn: () => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(() => {
    fn();
  });
  return () => {
    sub.remove();
  };
}
