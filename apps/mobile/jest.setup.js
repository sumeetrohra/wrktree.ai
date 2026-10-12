/* global jest -- reason: Jest injects it into setup files */
// Native modules the unit tests can't load (no device): small in-memory stand-ins.
jest.mock("react-native-mmkv", () => {
  const make = () => {
    const data = new Map();
    return {
      getString: (k) => data.get(k),
      set: (k, v) => data.set(k, v),
      remove: (k) => data.delete(k),
    };
  };
  return { createMMKV: make };
});

jest.mock("expo-secure-store", () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    deleteItemAsync: (k) => Promise.resolve(data.delete(k)),
  };
});
