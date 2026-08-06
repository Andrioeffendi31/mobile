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
  /**
   * WebAuthn credential ids held *by this device*.
   *
   * A passkey lives in the phone's keystore, so only the phone knows it has one —
   * the label we send at enrolment is "Android (biometrik)", which fits every
   * Android there is. The credential id is the one value both sides can name, so
   * the device keeps the ids it produced and the settings screen intersects them
   * with what /api/me reports: a match means "this device", and a passkey deleted
   * from the web console drops out of the intersection on its own.
   *
   * A list, not one id, because enrolling twice (reinstall, second attempt) leaves
   * two live credentials and forgetting the first would under-report.
   */
  passkeyIds: string[];
  addPasskeyId: (id: string) => void;
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
      passkeyIds: [],
      addPasskeyId: (id) =>
        set(({ passkeyIds }) =>
          passkeyIds.includes(id) ? {} : { passkeyIds: [...passkeyIds, id] },
        ),
      ready: false,
    }),
    {
      name: "ruanghr.prefs",
      storage,
      // `ready` describes this process, not the user's choice — persisting it
      // would restore a stale "already hydrated" on the next launch
      partialize: ({ theme, push, passkeyIds }) => ({ theme, push, passkeyIds }),
    },
  ),
);

// zustand marks rehydration done through the persist API rather than state, so
// mirror it into `ready` for the one component that has to wait for it
usePrefs.persist.onFinishHydration(() => usePrefs.setState({ ready: true }));
if (usePrefs.persist.hasHydrated()) usePrefs.setState({ ready: true });
