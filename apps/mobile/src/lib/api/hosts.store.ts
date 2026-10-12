import { create } from "zustand";

import type { TConnStatus } from "./connection.types";

export type THost = {
  id: string;
  name: string;
  status: TConnStatus;
  /** Reached through the local transport (this computer's own daemon, desktop web). */
  local: boolean;
};

/**
 * `signedOut`: no account on this device. `signedIn`: registered; hosts come from the relay.
 * `removed`: the account removed this device; sign in again.
 */
export type TAccountState = "signedOut" | "signedIn" | "removed";

type THostsState = {
  /** Every host this device can reach, the local one first. */
  hosts: THost[];
  account: TAccountState;
  /** The local daemon's page is still trading its one-time code (desktop web). */
  localPending: boolean;
};

/** Hosts and account state for the UI (client state, D2). Written only by the connection manager. */
export const useHostsStore = create<THostsState>(() => ({
  hosts: [],
  account: "signedOut",
  localPending: false,
}));
