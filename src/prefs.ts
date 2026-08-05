import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Persisted UI preferences (PRD-Mobile §5: Zustand + persist).
 *
 * Storage is expo-secure-store, which is already here for the session, rather
 * than adding AsyncStorage for one enum. Nothing secret lives in it — the
 * keychain is just the store we already have.
 */
const storage = createJSONStorage(() => ({
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
}));

export type ThemePref = "system" | "light" | "dark";

type PrefsState = {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  /**
   * Whether this device wants push at all. The OS permission is the other half:
   * this one lets somebody turn approvals off again without digging into the
   * system settings, and stops the tab layout re-registering a token at every
   * launch after they did.
   */
  push: boolean;
  setPush: (on: boolean) => void;
  /** false until the persisted value has been read, so the first paint does not
   *  flash the system theme at somebody who chose the other one */
  ready: boolean;
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      push: true,
      setPush: (push) => set({ push }),
      ready: false,
    }),
    {
      name: "ruanghr.prefs",
      storage,
      // `ready` describes this process, not the user's choice — persisting it
      // would restore a stale "already hydrated" on the next launch
      partialize: ({ theme, push }) => ({ theme, push }),
    },
  ),
);

// zustand marks rehydration done through the persist API rather than state, so
// mirror it into `ready` for the one component that has to wait for it
usePrefs.persist.onFinishHydration(() => usePrefs.setState({ ready: true }));
if (usePrefs.persist.hasHydrated()) usePrefs.setState({ ready: true });
