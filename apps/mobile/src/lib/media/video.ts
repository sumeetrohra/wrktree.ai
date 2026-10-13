import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { MAX_VIDEO_BYTES, VideoTooLargeError, type TPickedVideo } from "./video.types";

/** Picks a video from the library, as base64. Null when the user cancels. */
export async function pickVideo(): Promise<TPickedVideo | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1 });
  const asset = r.canceled ? undefined : r.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  const size = asset.fileSize ?? file.size;
  if (size > MAX_VIDEO_BYTES) throw new VideoTooLargeError(size);
  return { base64: await file.base64(), mime: asset.mimeType ?? "video/mp4", size };
}
