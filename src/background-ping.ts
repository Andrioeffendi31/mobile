import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { API, SESSION_KEY } from "@/api";

/**
 * Periodic location trail while the employee is clocked in — the background half
 * of POST /api/attendance/ping, which HR watches from the day-detail drawer in
 * the web console.
 *
 * The interval is a *floor*, not a promise: both platforms coalesce and delay
 * background wake-ups as they see fit, so the app asks for roughly three hours
 * and the server decides whether a ping is due (it rejects anything under ~2.5 h
 * with 409). That means an early or duplicated wake-up costs one wasted request
 * and nothing else — no client-side bookkeeping to get out of step.
 *
 * The task runs in a headless JS context with no React tree and no Zustand
 * store, so the session is read straight from SecureStore each time.
 */
export const PING_TASK = "ruanghr.location-ping";

const THREE_HOURS = 3 * 60 * 60 * 1000;

TaskManager.defineTask(PING_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[ping] task error", error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  const last = locations?.at(-1);
  if (!last) return;

  const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  // signed out while the task was queued: nothing to report it to
  if (!cookie) {
    await stopBackgroundPing();
    return;
  }

  try {
    const res = await fetch(`${API}/api/attendance/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lat: last.coords.latitude,
        lng: last.coords.longitude,
      }),
    });
    // 400 means the day is over (clocked out, or never clocked in) — the phone
    // stops asking rather than waking up hourly until midnight
    if (res.status === 400 || res.status === 401) await stopBackgroundPing();
  } catch {
    // offline: the next wake-up carries a fresh fix, so there is nothing to queue
  }
});

/** True when the employee granted "Allow all the time" / "Always". */
export async function canPingInBackground() {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status === "granted";
}

/**
 * Asks for background permission and starts the trail. Safe to call repeatedly —
 * it returns early if the task is already running.
 *
 * Returns false when the employee declines: clock-in still works, only the trail
 * is missing, and the caller decides whether to say anything about it.
 */
export async function startBackgroundPing(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return false;

  if (await Location.hasStartedLocationUpdatesAsync(PING_TASK)) return true;

  await Location.startLocationUpdatesAsync(PING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: THREE_HOURS,
    // iOS ignores timeInterval; deferred updates are the equivalent knob there
    deferredUpdatesInterval: THREE_HOURS,
    // a trail of where somebody is, not how they got there: any movement is
    // reported on schedule rather than per metre
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    // being tracked by your employer should be visible while it happens
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Ruang HR mencatat lokasi",
      notificationBody: "Aktif selama Anda masih absen masuk hari ini.",
      notificationColor: "#4f46e5",
      killServiceOnDestroy: false,
    },
  });
  return true;
}

export async function stopBackgroundPing() {
  if (await Location.hasStartedLocationUpdatesAsync(PING_TASK)) {
    await Location.stopLocationUpdatesAsync(PING_TASK);
  }
}
