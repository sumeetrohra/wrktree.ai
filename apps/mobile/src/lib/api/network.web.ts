/** Browsers report losing and regaining the network; react at once instead of waiting for timeouts. */
export function watchNetwork(onChange: (online: boolean) => void): void {
  globalThis.addEventListener("offline", () => {
    onChange(false);
  });
  globalThis.addEventListener("online", () => {
    onChange(true);
  });
}
