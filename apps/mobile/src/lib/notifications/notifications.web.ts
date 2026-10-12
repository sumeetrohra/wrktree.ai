/** The web build doesn't receive pushes (the desktop UI is open, or the phone app is used). */
export function registerForPush(): Promise<string | null> {
  return Promise.resolve(null);
}

export function onNotificationTap(_fn: () => void): () => void {
  return () => undefined;
}
