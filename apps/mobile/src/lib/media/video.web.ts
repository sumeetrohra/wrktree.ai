import * as ImagePicker from "expo-image-picker";

import { MAX_VIDEO_BYTES, VideoTooLargeError, type TPickedVideo } from "./video.types";

/** Bytes as base64, in slices (one `String.fromCharCode` call can't take megabytes). */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Picks a video file in the browser, as base64. Null when the user cancels. */
export async function pickVideo(): Promise<TPickedVideo | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"] });
  const file = r.canceled ? undefined : r.assets[0]?.file;
  if (!file) return null;
  if (file.size > MAX_VIDEO_BYTES) throw new VideoTooLargeError(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { base64: toBase64(bytes), mime: file.type || "video/mp4", size: file.size };
}
