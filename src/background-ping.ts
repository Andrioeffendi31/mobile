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
 *
 * A fix that cannot be uploaded is queued rather than dropped. Losing signal used
 * to mean losing three hours of the trail permanently, which reads afterwards as
 * an employee who was nowhere — indistinguishable from one who turned tracking
 * off. Each queued fix carries the time it was TAKEN, and the server records that
 * rather than the upload time.
 */
export const PING_TASK = "nanumhr.location-ping";

const THREE_HOURS = 3 * 60 * 60 * 1000;

/** [waktu ms, lat, lng] — tuple, bukan objek: hanya berkas ini yang menulis dan
 *  membacanya, sedangkan kunci JSON melipatgandakan ukurannya tanpa manfaat. */
type Antre = [number, number, number];

const QUEUE_KEY = "nanumhr.ping-queue";

/**
 * ponytail: 8 entri ≈ 24 jam pada interval 3 jam, ~330 B dari plafon ~2 KB per
 * nilai milik SecureStore Android. Padam lebih lama dari itu kehilangan fix
 * TERLAMA-nya — bukan yang terbaru: jejak yang titik terakhirnya basi sehari lebih
 * buruk daripada jejak yang bolong di pagi hari.
 */
const QUEUE_MAX = 8;

/** 6 desimal, karena kolomnya memang numeric(9,6) — digit sesudahnya dibuang server. */
const bulat = (n: number) => Math.round(n * 1e6) / 1e6;

async function bacaAntrean(): Promise<Antre[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Antre[]) : [];
  } catch {
    // isinya rusak: satu antrean tidak sepadan dengan trail yang macet selamanya
    return [];
  }
}

async function tulisAntrean(q: Antre[]) {
  if (q.length === 0) await SecureStore.deleteItemAsync(QUEUE_KEY).catch(() => {});
  else await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(q)).catch(() => {});
}

/** Dipanggil saat logout: koordinat mantan pengguna tidak punya tujuan kirim. */
export async function clearQueue() {
  await tulisAntrean([]);
}

type Hasil = "ok" | "drop" | "offline";

/**
 * Satu fix ke server. `drop` berarti "jangan coba lagi": 400 (harinya sudah
 * selesai, atau fix-nya di luar jendela hari itu) dan 409 (server sudah punya
 * baris di jendela yang sama) sama-sama tidak akan pernah berubah jawabannya.
 */
async function sendPing(
  lat: number,
  lng: number,
  at: number,
  cookie: string,
  mocked?: boolean,
): Promise<Hasil> {
  try {
    const res = await fetch(`${API}/api/attendance/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lat,
        lng,
        at: new Date(at).toISOString(),
        ...(mocked ? { mocked: true } : null),
      }),
    });
    // 400 means the day is over (clocked out, or never clocked in) — the phone
    // stops asking rather than waking up hourly until midnight
    if (res.status === 400 || res.status === 401) {
      await stopBackgroundPing();
      return "drop";
    }
    return res.ok || res.status === 409 ? "ok" : "drop";
  } catch {
    return "offline";
  }
}

/**
 * Kirim isi antrean, terlama dulu. **Berurutan**, bukan paralel: tiap baris yang
 * masuk menjadi pembanding jeda 2,5 jam bagi entri berikutnya, jadi mengirimnya
 * bersamaan justru membuat mereka saling menolak. Berhenti pada `offline` pertama
 * dan menyimpan sisanya — jaringan yang baru saja gagal tidak akan berhasil di
 * entri berikutnya.
 */
export async function flushQueue(cookie: string) {
  const q = await bacaAntrean();
  if (q.length === 0) return;
  let i = 0;
  for (; i < q.length; i++) {
    const [at, lat, lng] = q[i];
    if ((await sendPing(lat, lng, at, cookie)) === "offline") break;
  }
  await tulisAntrean(q.slice(i));
}

async function enqueue(lat: number, lng: number, at: number) {
  const q = await bacaAntrean();
  q.push([at, bulat(lat), bulat(lng)]);
  await tulisAntrean(q.slice(-QUEUE_MAX));
}

/**
 * Satu fix, dikirim atau diantre. Dipakai oleh task latar belakang dan oleh ping
 * susulan saat aplikasi kembali ke depan, supaya keduanya tidak menyimpan salinan
 * aturan yang sama.
 */
export async function kirimAtauAntre(fix: Location.LocationObject) {
  const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  // signed out while the task was queued: nothing to report it to
  if (!cookie) {
    await stopBackgroundPing();
    return;
  }

  // Fix lama harus mendarat lebih dulu: aturan jeda server diukur dari baris
  // terakhir, jadi mengirim yang baru duluan akan menolak seluruh antrean.
  await flushQueue(cookie);

  const at = fix.timestamp || Date.now();
  const hasil = await sendPing(
    fix.coords.latitude,
    fix.coords.longitude,
    at,
    cookie,
    // Android melaporkan sendiri fix yang datang dari mock location provider.
    // Ping tidak pernah ditolak karenanya — server yang menandainya untuk HR.
    fix.mocked,
  );
  if (hasil === "offline") await enqueue(fix.coords.latitude, fix.coords.longitude, at);
}

TaskManager.defineTask(PING_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[ping] task error", error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  const last = locations?.at(-1);
  if (!last) return;
  await kirimAtauAntre(last);
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
      notificationTitle: "NanumHR mencatat lokasi",
      notificationBody: "Aktif selama Anda masih absen masuk hari ini.",
      notificationColor: "#4f46e5",
      // false: layanan bertahan saat aplikasi digeser dari daftar aplikasi
      // terkini. Force-stop tetap mematikannya — itu batas Android, bukan pilihan.
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

/**
 * Ping susulan saat aplikasi kembali ke depan — yang menutup lubang setelah
 * force-stop, reboot, atau padamnya jaringan sepanjang siang.
 *
 * ponytail: tidak ada catatan "kapan ping terakhir" yang dipersistensi — server
 * sudah memegang jawabannya dan membalas 409, seharga satu request per cold start.
 * Penjaganya hanya cap waktu di memori, jadi ia ikut hilang bersama prosesnya.
 * 30 menit itu knob kalibrasinya: kalau fix yang terbuang muncul di laporan
 * baterai, angka inilah yang diputar.
 */
let terakhirSusul = 0;
const JEDA_SUSUL = 30 * 60 * 1000;

export async function catchUpPing() {
  if (Date.now() - terakhirSusul < JEDA_SUSUL) return;
  const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  if (!cookie) return;
  terakhirSusul = Date.now();

  await flushQueue(cookie);
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return;
  try {
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await kirimAtauAntre(fix);
  } catch {
    // GPS tidak menjawab: wake-up terjadwal berikutnya membawa fix segar
  }
}
