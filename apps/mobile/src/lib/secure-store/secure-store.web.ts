/**
 * Web has no keychain. The desktop web build normally talks to the local daemon and never stores
 * relay secrets; when it does pair through the relay (development, E2E), secrets go to
 * localStorage, readable by anything running on this origin.
 */
export const secureStore = {
  get(key: string): string | null {
    return globalThis.localStorage.getItem(`secure.${key}`);
  },
  set(key: string, value: string): void {
    globalThis.localStorage.setItem(`secure.${key}`, value);
  },
  remove(key: string): void {
    globalThis.localStorage.removeItem(`secure.${key}`);
  },
};
