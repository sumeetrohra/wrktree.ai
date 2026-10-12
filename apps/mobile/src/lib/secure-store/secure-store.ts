import * as SecureStore from "expo-secure-store";

/** Secrets (identity key, tokens) in the platform keychain. Synchronous reads keep boot simple. */
export const secureStore = {
  get(key: string): string | null {
    return SecureStore.getItem(key);
  },
  set(key: string, value: string): void {
    SecureStore.setItem(key, value);
  },
  remove(key: string): void {
    void SecureStore.deleteItemAsync(key);
  },
};
