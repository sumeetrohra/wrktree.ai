import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

export type TPickedImage = { base64: string; mime: string };

/** Picks one image from the library, as base64. Null when the user cancels. */
export async function pickImage(): Promise<TPickedImage | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.8 });
  const asset = r.canceled ? undefined : r.assets[0];
  if (!asset?.base64) return null;
  return { base64: asset.base64, mime: asset.mimeType ?? "image/jpeg" };
}

/** Takes a photo with the camera, as base64. Null when the user cancels or denies access. */
export async function takePhoto(): Promise<TPickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 });
  const asset = r.canceled ? undefined : r.assets[0];
  if (!asset?.base64) return null;
  return { base64: asset.base64, mime: asset.mimeType ?? "image/jpeg" };
}

/** An image on the clipboard (a pasted screenshot), as base64 PNG. */
export async function clipboardImage(): Promise<TPickedImage | null> {
  if (!(await Clipboard.hasImageAsync())) return null;
  const img = await Clipboard.getImageAsync({ format: "png" });
  if (!img) return null;
  return { base64: img.data.replace(/^data:image\/png;base64,/, ""), mime: "image/png" };
}

export async function clipboardText(): Promise<string> {
  return Clipboard.getStringAsync();
}
