import * as Device from "expo-device";
import * as Haptics from "expo-haptics";

/** A short buzz when something needs the user (a permission request). Never throws. */
export function attentionHaptic(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

/** A name the desktop shows for this phone during pairing. */
export function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? "Phone";
}
