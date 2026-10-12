import { create } from "zustand";

import type { TPairingOffer } from "@/lib/api";

type TPairingState = {
  offer: TPairingOffer | null;
  code: string | null;
  setOffer: (offer: TPairingOffer) => void;
  setCode: (code: string) => void;
  reset: () => void;
};

/** The pairing in progress during onboarding (client state, not persisted). */
export const usePairingStore = create<TPairingState>()((set) => ({
  offer: null,
  code: null,
  setOffer: (offer) => {
    set({ offer, code: null });
  },
  setCode: (code) => {
    set({ code });
  },
  reset: () => {
    set({ offer: null, code: null });
  },
}));
