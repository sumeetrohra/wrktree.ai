export type TPickedVideo = { base64: string; mime: string; size: number };

/** The largest video a message can carry (the computer's upload cap). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Thrown when the picked video is over `MAX_VIDEO_BYTES`. */
export class VideoTooLargeError extends Error {
  constructor(readonly size: number) {
    super("video too large");
  }
}
