import { create } from "zustand";

import type { TConnStatus } from "./connection.types";

type TConnectionState = {
  status: TConnStatus;
  /** The paired machine's name, once paired. */
  machineName: string | null;
  /** Whether this build talks to the local daemon directly (desktop web). */
  local: boolean;
};

/** Connection status for the UI (client state, D2). Written only by the connection manager. */
export const useConnectionStore = create<TConnectionState>(() => ({
  status: "unpaired",
  machineName: null,
  local: false,
}));
