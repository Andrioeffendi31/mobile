import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { create } from "zustand";
import { postJson } from "@/api";

/**
 * Push notifications (PRD-Mobile §6.6).
 *
 * The token is registered after login and removed at logout, so a phone handed
 * on to somebody else stops receiving the previous owner's approvals.
 *
 * Requires a development or EAS build: Expo Go cannot receive push on Android
 * since SDK 53. Without an EAS projectId there is no token to fetch either, so
 * registration reports why and gives up rather than throwing into a login flow
 * that otherwise succeeded.
 */

/** Show the banner even with the app open — approvals are worth interrupting for. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const projectId = () =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId ?? Constants.easConfig?.projectId;

let current: string | null = null;

/**
 * Why push is not working, or null when it is. A store rather than a variable:
 * registration finishes after the first render, and the Info screen has to
 * re-render when it does — a diagnostic that never updates is worse than none.
 */
export const usePushStatus = create<{ reason: string | null }>(() => ({
  reason: "Belum didaftarkan",
}));

const setReason = (reason: string | null) => usePushStatus.setState({ reason });


/**
 * The push failure, in one line an employee can act on.
 *
 * Expo's own message for a missing Firebase config is six sentences of build
 * advice with a documentation URL in the middle, and it was being printed verbatim
 * into a settings row. It is the right text for a developer reading Metro and the
 * wrong text for somebody wondering why their phone is quiet — the specifics
 * belong in the log, which is where they still go.
 */
function explain(e: Error): string {
  const raw = e.message ?? "";
  console.warn("[push]", raw);

  if (/FirebaseApp|googleServicesFile|Firebase Messaging/i.test(raw)) {
    return "Server notifikasi belum dikonfigurasi (Firebase) · hubungi tim IT";
  }
  if (/network|timeout|ENOTFOUND|Unable to resolve host/i.test(raw)) {
    return "Tidak bisa menghubungi server notifikasi · periksa koneksi";
  }
  return "Token pemberitahuan gagal diambil · coba lagi nanti";
}

export async function registerForPush(): Promise<
  { ok: true; token: string } | { ok: false; reason: string }
> {
  const fail = (reason: string) => {
    setReason(reason);
    return { ok: false as const, reason };
  };

  /**
   * No emulator guard any more.
   *
   * This used to bail on `!Constants.isDevice`, which expo-constants removed along
   * with the other deprecated properties — so it read `undefined` on every device
   * and the check failed for everybody, on real hardware included, before a single
   * notification API had been touched. The switch simply never turned on.
   *
   * Nothing replaces it: an emulator without Play Services fails at
   * getExpoPushTokenAsync a few lines down, and that path already reports the real
   * reason instead of a guess made up front. Restoring the guard would mean adding
   * expo-device — a native module, and another rebuild — to say something the
   * failure already says.
   */
  const id = projectId();
  if (!id) return fail("EAS projectId belum diisi di app.json");

  // Android 13+ refuses to hand out a token before a channel exists
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Pemberitahuan NanumHR",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted ||
    existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const perm = granted ? existing : await Notifications.requestPermissionsAsync();
  if (!perm.granted && perm.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return fail("Izin notifikasi ditolak di setelan perangkat");
  }

  // this is where a missing google-services.json / FCM key surfaces: Expo cannot
  // mint a token for an app that FCM does not know
  let token: string;
  try {
    ({ data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id }));
  } catch (e) {
    return fail(explain(e as Error));
  }

  await postJson("/api/me/push", { token, platform: Platform.OS });
  current = token;
  setReason(null);
  return { ok: true as const, token };
}

/**
 * Drops this device's subscription. Called before the session is cleared, since
 * the endpoint needs the cookie to know whose token it is.
 */
export async function unregisterFromPush() {
  if (!current) return;
  await postJson("/api/me/push", { token: current, platform: Platform.OS }, "DELETE").catch(
    () => undefined,
  );
  current = null;
}
