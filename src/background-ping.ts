import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { API, SESSION_KEY } from "@/api";
import {
  checkConnectivityNow,
  markInternetConnected,
  notifyInternetDisconnected,
  startConnectivityMonitor,
} from "@/connectivity";
import { jamWib } from "@/format";

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
export const WATCHDOG_TASK = "nanumhr.background-watchdog";

const THREE_HOURS = 3 * 60 * 60 * 1000;
const WATCHDOG_MINUTES = 15;
const WATCHDOG_TIMEOUT_MS = 12_000;

/** [waktu ms, lat, lng, nama tempat] — tuple, bukan objek: hanya berkas ini yang
 *  menulis dan membacanya, sedangkan kunci JSON melipatgandakan ukurannya tanpa
 *  manfaat. Nama tempatnya ikut diantre karena ia hasil pencarian yang butuh
 *  jaringan: menerjemahkannya nanti saat online berarti menerjemahkan koordinat
 *  jam 8 pagi memakai data jam 5 sore, dan itu tetap benar tapi tidak lagi murah. */
type Antre = [number, number, number, string?];

const QUEUE_KEY = "nanumhr.ping-queue";

/**
 * ponytail: 8 entri ≈ 24 jam pada interval 3 jam, ~330 B dari plafon ~2 KB per
 * nilai milik SecureStore Android. Padam lebih lama dari itu kehilangan fix
 * TERLAMA-nya — bukan yang terbaru: jejak yang titik terakhirnya basi sehari lebih
 * buruk daripada jejak yang bolong di pagi hari.
 */
const QUEUE_MAX = 8;

/**
 * Koordinat → nama tempat, seperti yang sudah dilakukan layar absen. Selalu boleh
 * gagal: offline, tidak ada hasil, atau perangkat tanpa layanan geocoder — dan
 * baris tanpa nama tempat masih jauh lebih berguna daripada tidak ada baris.
 */
async function namaTempat(lat: number, lng: number): Promise<string | undefined> {
  const [tempat] = await Location.reverseGeocodeAsync({
    latitude: lat,
    longitude: lng,
  }).catch(() => []);
  if (!tempat) return undefined;
  const label = [tempat.street, tempat.district ?? tempat.city]
    .filter(Boolean)
    .join(", ");
  // kolomnya 120 karakter; alamat yang lebih panjang dari itu bukan alamat lagi
  return label ? label.slice(0, 120) : undefined;
}

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

type BootstrapLite = {
  today: {
    clockIn: string | null;
    clockOut: string | null;
  };
};

type BootstrapRead =
  | { kind: "ok"; data: BootstrapLite }
  | { kind: "unauthorized" }
  | { kind: "offline" };

async function bacaBootstrap(cookie: string): Promise<BootstrapRead> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WATCHDOG_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/api/me`, {
      signal: controller.signal,
      headers: { cookie },
    });
    if (res.status === 401) return { kind: "unauthorized" };
    if (!res.ok) return { kind: "offline" };
    return { kind: "ok", data: (await res.json()) as BootstrapLite };
  } catch {
    return { kind: "offline" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureBackgroundWatchdog(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync().catch(() => null);
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return false;

  const registered = await TaskManager.isTaskRegisteredAsync(WATCHDOG_TASK).catch(
    () => false,
  );
  if (registered) return true;

  await BackgroundTask.registerTaskAsync(WATCHDOG_TASK, {
    minimumInterval: WATCHDOG_MINUTES,
  });
  return true;
}

export async function stopBackgroundWatchdog() {
  const registered = await TaskManager.isTaskRegisteredAsync(WATCHDOG_TASK).catch(
    () => false,
  );
  if (registered) {
    await BackgroundTask.unregisterTaskAsync(WATCHDOG_TASK);
  }
}

/**
 * Bahan untuk kalimat di notifikasi layanan: [jam absen masuk, waktu ping terakhir].
 *
 * Di SecureStore, bukan di zustand: yang menuliskan waktu ping terakhir adalah task
 * headless, yang berjalan tanpa React tree dan tanpa store sama sekali.
 */
type Status = [masuk: string, ping: number | null];

const STATUS_KEY = "nanumhr.trail-status";

async function bacaStatus(): Promise<Status> {
  const raw = await SecureStore.getItemAsync(STATUS_KEY).catch(() => null);
  try {
    return raw ? (JSON.parse(raw) as Status) : ["", null];
  } catch {
    return ["", null];
  }
}

/**
 * Jam masuk yang tersimpan, atau `null` kalau tidak ada.
 *
 * Dipisah karena "tidak ada" di sini berbentuk **string kosong**, bukan null:
 * `bacaStatus()` mengembalikan `["", null]` untuk kunci yang tidak ada, dan
 * `stopBackgroundPing()` menghapus kuncinya saat absen keluar. Jadi keberadaan
 * jam masuk di sini adalah satu-satunya penanda "sedang clock in" yang bertahan
 * lintas proses TANPA internet — dan satu `if` yang salah membaca `""` sebagai
 * "ada" akan menyalakan jejak untuk orang yang sudah pulang.
 */
export function masukTersimpan(status: Status): string | null {
  const [masuk] = status;
  return masuk ? masuk : null;
}

/** Jam masuk terakhir yang diketahui, dibaca dari penyimpanan. Satu-satunya
 *  jawaban yang tersedia saat server tidak bisa dihubungi. */
export async function masukTerakhir(): Promise<string | null> {
  return masukTersimpan(await bacaStatus());
}

async function tulisStatus(s: Status) {
  await SecureStore.setItemAsync(STATUS_KEY, JSON.stringify(s)).catch(() => {});
}

/**
 * Isi notifikasi, satu baris.
 *
 * Status di depan dan jam masuk di belakang, bukan sebaliknya: Android memotong
 * `setContentText` di sekitar 40–50 karakter pada tampilan terlipat, dan yang
 * hilang adalah bagian kanan. Yang berubah-ubah harus selamat, yang tetap boleh
 * terpotong.
 */
function kalimat(status: Status, antre: number): string {
  const [masuk, ping] = status;
  const ekor = masuk ? ` · masuk ${masuk}` : "";
  if (antre > 0) return `${antre} titik menunggu jaringan${ekor}`;
  if (ping) return `Lokasi tercatat ${jamWib(false, ping)}${ekor}`;
  return `Lokasi dicatat tiap ~3 jam${ekor}`;
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
  opsi: {
    mocked?: boolean;
    location?: string;
    delayed?: boolean;
    /** fix yang diambil tepat saat koneksi kembali, di luar irama 3 jam */
    reconnect?: boolean;
  } = {},
): Promise<Hasil> {
  /**
   * Dengan timeout, dan itu bukan kehati-hatian teoretis: di jaringan seluler
   * yang buruk socket bisa menggantung sampai OS memutusnya sendiri, dan tugas
   * latar belakang ini berhenti di tengah — antrean tidak terisi dan notifikasi
   * offline tidak pernah muncul, karena keduanya ada di jalur SESUDAH panggilan
   * ini. Ambangnya sama dengan `bacaBootstrap` di atas: satu angka untuk satu
   * jenis penantian.
   */
  const batal = new AbortController();
  const jam = setTimeout(() => batal.abort(), WATCHDOG_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/api/attendance/ping`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      signal: batal.signal,
      body: JSON.stringify({
        lat,
        lng,
        at: new Date(at).toISOString(),
        ...(opsi.mocked ? { mocked: true } : null),
        ...(opsi.location ? { location: opsi.location } : null),
        ...(opsi.delayed ? { delayed: true } : null),
        ...(opsi.reconnect ? { reconnect: true } : null),
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
    // abort ikut ke sini, dan itu memang yang diinginkan: permintaan yang tidak
    // pernah dijawab sama saja dengan tidak ada jaringan
    await notifyInternetDisconnected("request");
    return "offline";
  } finally {
    clearTimeout(jam);
  }
}

/**
 * Kirim isi antrean, terlama dulu. **Berurutan**, bukan paralel: tiap baris yang
 * masuk menjadi pembanding jeda 2,5 jam bagi entri berikutnya, jadi mengirimnya
 * bersamaan justru membuat mereka saling menolak. Berhenti pada `offline` pertama
 * dan menyimpan sisanya — jaringan yang baru saja gagal tidak akan berhasil di
 * entri berikutnya.
 */
/** Satu flush pada satu waktu: antreannya baca-ubah-tulis, dan dua pengirim yang
 *  berjalan bersamaan bisa mengirim entri yang sama dua kali. */
let flushBerjalan: Promise<void> | null = null;

export function flushQueue(cookie: string): Promise<void> {
  if (flushBerjalan) return flushBerjalan;
  flushBerjalan = jalankanFlush(cookie).finally(() => {
    flushBerjalan = null;
  });
  return flushBerjalan;
}

async function jalankanFlush(cookie: string) {
  const q = await bacaAntrean();
  if (q.length === 0) return;
  let i = 0;
  for (; i < q.length; i++) {
    const [at, lat, lng, tempat] = q[i];
    // `delayed`: fix ini diambil saat ponsel offline dan baru terkirim sekarang.
    // Itu yang membedakan "tidak ada sinyal" dari "aplikasinya memang mati" pada
    // jejak yang dilihat HR — keduanya sama-sama menghasilkan lubang, tapi hanya
    // satu di antaranya kesalahan siapa pun.
    const hasil = await sendPing(lat, lng, at, cookie, {
      location: tempat,
      delayed: true,
    });
    if (hasil === "offline") break;
  }
  await tulisAntrean(q.slice(i));
  if (i > 0) await markInternetConnected();
}

async function enqueue(lat: number, lng: number, at: number, tempat?: string) {
  const q = await bacaAntrean();
  q.push(tempat ? [at, bulat(lat), bulat(lng), tempat] : [at, bulat(lat), bulat(lng)]);
  await tulisAntrean(q.slice(-QUEUE_MAX));
}

/**
 * Satu fix, dikirim atau diantre. Dipakai oleh task latar belakang dan oleh ping
 * susulan saat aplikasi kembali ke depan, supaya keduanya tidak menyimpan salinan
 * aturan yang sama.
 */
export async function kirimAtauAntre(
  fix: Location.LocationObject,
  opsi: { reconnect?: boolean } = {},
) {
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
  const { latitude: lat, longitude: lng } = fix.coords;
  // Diterjemahkan SEBELUM dikirim, dan hasilnya ikut diantre kalau pengirimannya
  // gagal: tanpa ini baris ping hanya berisi koordinat, sementara baris absen di
  // atasnya menyebut nama jalan — perbedaan yang membuat log lokasi terbaca
  // setengah jadi.
  const tempat = await namaTempat(lat, lng);
  const hasil = await sendPing(lat, lng, at, cookie, {
    // Android melaporkan sendiri fix yang datang dari mock location provider.
    // Ping tidak pernah ditolak karenanya — server yang menandainya untuk HR.
    mocked: fix.mocked,
    location: tempat,
    reconnect: opsi.reconnect,
  });

  if (hasil === "offline") {
    await enqueue(lat, lng, at, tempat);
  } else if (hasil === "ok") {
    await markInternetConnected();
    const [masuk] = await bacaStatus();
    await tulisStatus([masuk, at]);
  }
  // Satu-satunya tempat teksnya boleh berubah tanpa penyesalan: hitungan tiga jam
  // yang ikut ter-reset memang seharusnya dimulai dari ping barusan.
  await perbaruiStatus();
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
/**
 * Judulnya menjawab pertanyaan yang membuat orang menarik notifikasinya turun.
 * Yang sedang dikerjakan aplikasi ada di baris isi, karena itulah yang berubah.
 */
const JUDUL = "NanumHR berjalan di latar belakang";

/** Opsi task, dengan isi notifikasi sebagai satu-satunya yang berbeda antar panggilan. */
const opsiTrail = (isi: string): Location.LocationTaskOptions => ({
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
    notificationTitle: JUDUL,
    notificationBody: isi,
    notificationColor: "#4f46e5",
    // false: layanan bertahan saat aplikasi digeser dari daftar aplikasi
    // terkini. Force-stop tetap mematikannya — itu batas Android, bukan pilihan.
    killServiceOnDestroy: false,
  },
});

/**
 * Kalimat yang sedang terpasang, sejauh yang diketahui proses ini. Hanya di memori:
 * kalau prosesnya diganti, panggilan pertama berikutnya sekadar memasang ulang teks
 * yang sama — sekali, bukan berulang.
 */
let teksTerpasang: string | null = null;

/**
 * Segarkan isi notifikasi layanan.
 *
 * Mendaftarkan ulang task dengan opsi baru memang memperbarui notifikasi di tempat
 * (`TaskService.registerTask` melihat task-nya sudah ada lalu memanggil
 * `consumer.setOptions`, yang berujung ke `startForeground` dengan bundel baru) —
 * TAPI `setOptions` juga menjalankan `stopLocationUpdates(); startLocationUpdates()`,
 * sehingga hitungan tiga jam menuju ping berikutnya ikut ter-reset.
 *
 * Karena itu kalimatnya dibandingkan dulu dan panggilannya dilewati kalau tidak ada
 * yang berubah. Tanpa penjaga itu, `catchUpPing` yang boleh jalan tiap 30 menit akan
 * terus mendorong jadwal ping ke depan dan tidak ada ping terjadwal yang pernah
 * jatuh tempo — notifikasi kosmetik yang mematikan fitur sungguhan.
 */
/**
 * Notifikasi jejak yang MENETAP — pendamping notifikasi layanan, bukan
 * penggantinya.
 *
 * Kenapa perlu dua: notifikasi milik layanan latar depan dibangun di dalam
 * expo-location (`LocationTaskService.buildServiceNotification`) yang hanya
 * memasang `setCategory(CATEGORY_SERVICE)` dan `setSmallIcon` — tanpa
 * `setOngoing`, dan tidak ada satu pun opsi JS untuk menyalakannya. Bahkan kalau
 * ada, sejak Android 13 pengguna memang diizinkan menggeser notifikasi layanan
 * latar depan; menggesernya TIDAK menghentikan pelacakan, tapi membuat jejak yang
 * sedang berjalan tidak lagi terlihat.
 *
 * Yang bisa dijamin adalah notifikasi milik kita sendiri: `sticky: true` di
 * expo-notifications memasang `FLAG_ONGOING_EVENT`, dan notifikasi ongoing tidak
 * bisa digeser maupun terhapus oleh "Hapus semua". Channelnya sendiri, importance
 * LOW: menetap dan senyap, tanpa bunyi dan tanpa getar setiap kali diperbarui.
 *
 * Isinya kalimat yang sama dengan notifikasi layanan — satu sumber (`kalimat()`),
 * jadi keduanya tidak mungkin bercerita berbeda.
 */
const JEJAK_NOTIF_ID = "nanumhr-jejak";
const JEJAK_CHANNEL = "jejak";

async function pasangNotifJejak(isi: string) {
  // `sticky` hanya berarti sesuatu di Android; di iOS notifikasi tidak punya
  // padanan ongoing, dan memaksakannya hanya akan menumpuk baris tak berguna
  if (Platform.OS !== "android") return;
  const izin = await Notifications.getPermissionsAsync().catch(() => null);
  if (!izin?.granted) return;
  try {
    await Notifications.setNotificationChannelAsync(JEJAK_CHANNEL, {
      name: "Presensi berjalan",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      showBadge: false,
    });
    await Notifications.scheduleNotificationAsync({
      // identifier tetap: memperbarui teksnya MENGGANTI barisnya, tidak menambah
      identifier: JEJAK_NOTIF_ID,
      content: {
        title: "Presensi NanumHR aktif",
        body: isi,
        sticky: true,
        // diklik: tidak hilang, karena keadaannya belum berubah
        autoDismiss: false,
        color: "#4f46e5",
        data: { route: "/" },
      },
      trigger: { channelId: JEJAK_CHANNEL },
    });
  } catch (e) {
    // notifikasi pendamping gagal bukan alasan menggagalkan pelacakannya
    console.warn("[ping] notifikasi jejak gagal dipasang", (e as Error).message);
  }
}

async function lepasNotifJejak() {
  await Notifications.dismissNotificationAsync(JEJAK_NOTIF_ID).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(JEJAK_NOTIF_ID).catch(
    () => {},
  );
}

export async function perbaruiStatus() {
  if (!(await Location.hasStartedLocationUpdatesAsync(PING_TASK))) return;
  const isi = kalimat(await bacaStatus(), (await bacaAntrean()).length);
  // dipasang lebih dulu dan tanpa penjaga teks: notifikasi ini bisa hilang oleh
  // sebab di luar kendali kita (proses dimatikan, notifikasi dibersihkan ROM),
  // dan memasang ulang isi yang sama tidak berbiaya apa pun
  await pasangNotifJejak(isi);
  if (isi === teksTerpasang) return;
  try {
    await Location.startLocationUpdatesAsync(PING_TASK, opsiTrail(isi));
    teksTerpasang = isi;
  } catch (e) {
    // izin dicabut di tengah jalan: notifikasinya basi, tapi tidak ada yang rusak
    console.warn("[ping] gagal memperbarui notifikasi", (e as Error).message);
  }
}

/**
 * Asks for background permission and starts the trail. Safe to call repeatedly —
 * it refreshes the notification text and returns early if the task is already
 * running.
 *
 * `masuk` hanya untuk kalimat di notifikasi ("masuk 08:12"); "" kalau jamnya tidak
 * diketahui, dan kalimatnya tinggal menghilangkan ekornya.
 *
 * Returns false when the employee declines: clock-in still works, only the trail
 * is missing, and the caller decides whether to say anything about it.
 */
export async function startBackgroundPing(masuk = ""): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return false;

  // Jam masuk berbeda berarti hari kerja yang lain: waktu ping kemarin tidak boleh
  // ikut terbawa, atau notifikasi pagi ini akan memamerkan jam sore kemarin.
  const [masukLama, pingLama] = await bacaStatus();
  const ping = masuk === masukLama ? pingLama : null;
  await tulisStatus([masuk, ping]);

  if (await Location.hasStartedLocationUpdatesAsync(PING_TASK)) {
    await ensureBackgroundWatchdog();
    // sudah jalan sejak peluncuran sebelumnya: yang tersisa hanya menyegarkan
    // kalimatnya (dan memastikan notifikasi menetapnya masih ada)
    await perbaruiStatus();
    return true;
  }

  const isi = kalimat([masuk, ping], (await bacaAntrean()).length);
  await Location.startLocationUpdatesAsync(PING_TASK, opsiTrail(isi));
  await ensureBackgroundWatchdog();
  await pasangNotifJejak(isi);
  teksTerpasang = isi;
  return true;
}

export async function stopBackgroundPing() {
  if (await Location.hasStartedLocationUpdatesAsync(PING_TASK)) {
    await Location.stopLocationUpdatesAsync(PING_TASK);
  }
  // Notifikasi layanan hilang bersama layanannya, tapi notifikasi menetap milik
  // kita TIDAK — ia ongoing, jadi tidak ada yang akan menyingkirkannya kalau
  // bukan kita sendiri. Absen keluar harus melepasnya, kalau tidak ia menetap
  // sampai aplikasinya dipasang ulang.
  await lepasNotifJejak();
  // Bahan kalimatnya tidak lagi punya arti — dan kalau tertinggal, ia akan muncul
  // lagi sebagai keadaan kemarin.
  await SecureStore.deleteItemAsync(STATUS_KEY).catch(() => {});
  teksTerpasang = null;
}

/**
 * Ping susulan: menutup lubang sesudah force-stop, reboot, atau padamnya jaringan
 * sepanjang siang — dan sekarang juga pemicu tambahan saat koneksi pulih.
 *
 * Dua penjaga, dan keduanya perlu:
 *
 * `JEDA_SUSUL` (30 menit) adalah penjaga biasa — knob kalibrasi: kalau fix yang
 * terbuang muncul di laporan baterai, angka inilah yang diputar.
 *
 * `JEDA_PAKSA` (1 menit) adalah lantai yang berlaku BAHKAN untuk `force`.
 * Tanpanya, koneksi yang pulih memicu dua jalur yang sah sekaligus — listener
 * NetInfo di proses yang hidup dan watchdog yang kebetulan bangun pada detik
 * yang sama — dan keduanya memaksa satu ping masing-masing. Servernya memang
 * akan menjawab 409 pada yang kedua (jendela 2,5 jam), jadi barisnya tidak
 * ganda; yang terbuang adalah satu pembacaan GPS dan satu permintaan, dan itu
 * dibayar dari baterai orang.
 *
 * Cap waktunya DIPERSISTENSI, tidak lagi hanya di memori: watchdog headless dan
 * layar yang sedang terbuka bisa berupa dua konteks JS yang berbeda, dan penjaga
 * yang hidup di memori satu proses tidak menahan apa pun di proses yang lain.
 */
const JEDA_SUSUL = 30 * 60 * 1000;
const JEDA_PAKSA = 60 * 1000;
const SUSUL_KEY = "nanumhr.last-catchup";

/**
 * Satu susulan berjalan pada satu waktu dalam konteks ini.
 *
 * Pemanggil biasa MENUMPANG yang sedang berjalan — tidak ada gunanya dua
 * pembacaan GPS untuk pertanyaan yang sama. Pemanggil `force` (koneksi baru
 * pulih) tidak boleh menumpang: yang sedang berjalan mungkin baru saja berhenti
 * di penjaga 30 menit tanpa mengirim apa pun, dan menumpanginya berarti ping
 * yang justru diminta pengguna tidak pernah terjadi. Ia MENGANTRE di belakangnya,
 * lalu dinilai ulang oleh cap waktu yang dipersistensi — yang menahannya kalau
 * ternyata ping memang baru saja terkirim.
 */
let susulBerjalan: Promise<void> | null = null;

export function catchUpPing(
  opsi: { force?: boolean; reconnect?: boolean } = {},
): Promise<void> {
  if (susulBerjalan && !opsi.force) return susulBerjalan;
  const sesudah = susulBerjalan ?? Promise.resolve();
  // `dipegang` HARUS promise yang sama dengan yang disimpan di `susulBerjalan`.
  // Membandingkan dengan promise sebelum `.finally()` tidak akan pernah cocok —
  // objeknya berbeda — dan kuncinya tidak pernah dilepas: sesudah satu susulan,
  // setiap panggilan biasa berikutnya menumpang promise yang sudah selesai dan
  // tidak mengirim apa pun. Ditemukan oleh simulasi jeda di scratchpad.
  let dipegang: Promise<void>;
  dipegang = sesudah
    .catch(() => {})
    .then(() => jalankanSusulan(opsi))
    .finally(() => {
      if (susulBerjalan === dipegang) susulBerjalan = null;
    });
  susulBerjalan = dipegang;
  return dipegang;
}

async function jalankanSusulan(opsi: { force?: boolean; reconnect?: boolean }) {
  const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  if (!cookie) return;

  const now = Date.now();
  const terakhir = Number(
    (await SecureStore.getItemAsync(SUSUL_KEY).catch(() => null)) ?? 0,
  );
  const jeda = opsi.force ? JEDA_PAKSA : JEDA_SUSUL;
  if (Number.isFinite(terakhir) && now - terakhir < jeda) return;
  // ditulis SEBELUM pekerjaannya, bukan sesudah: yang menahan ping kedua adalah
  // cap waktu ini, dan menulisnya sesudah GPS menjawab meninggalkan jendela
  // beberapa detik tempat dua konteks bisa lewat bersamaan
  await SecureStore.setItemAsync(SUSUL_KEY, String(now)).catch(() => {});

  await flushQueue(cookie);
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return;
  try {
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await kirimAtauAntre(fix, { reconnect: opsi.reconnect });
  } catch {
    // GPS tidak menjawab: wake-up terjadwal berikutnya membawa fix segar. Antreannya
    // mungkin sudah terkirim di atas, jadi kalimatnya tetap perlu disegarkan.
    await perbaruiStatus();
  }
}

export async function reconcileBackgroundPingFromServer(opsi: { forceCatchUp?: boolean } = {}) {
  const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
  if (!cookie) {
    await stopBackgroundPing();
    await clearQueue();
    return;
  }

  const bootstrap = await bacaBootstrap(cookie);
  if (bootstrap.kind === "unauthorized") {
    await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
    await stopBackgroundPing();
    await clearQueue();
    return;
  }
  if (bootstrap.kind === "offline") {
    await notifyInternetDisconnected("background");
    /**
     * Server tidak bisa ditanya — jadi keadaan TERAKHIR YANG DIKETAHUI yang
     * dipakai, bukan menyerah.
     *
     * Ini kasus yang paling merugikan sebelum ada cabang ini: sesudah force-stop,
     * karyawan membuka aplikasinya di tempat tanpa sinyal — satu-satunya
     * pemulihan yang Android sediakan — dan justru di situ jejaknya tidak
     * dinyalakan, karena `/api/me` tidak pernah menjawab.
     *
     * Fix-nya diambil dari GPS (yang tidak butuh jaringan), masuk antrean dengan
     * jam pengambilannya, dan menyusul sendiri begitu ada sinyal.
     */
    const masuk = masukTersimpan(await bacaStatus());
    if (masuk) {
      const started = await startBackgroundPing(masuk);
      if (started) await catchUpPing({ force: true });
      return;
    }
    await perbaruiStatus();
    return;
  }

  await flushQueue(cookie);

  const { clockIn, clockOut } = bootstrap.data.today;
  if (!clockIn || clockOut) {
    await stopBackgroundPing();
    return;
  }

  const wasRunning = await Location.hasStartedLocationUpdatesAsync(PING_TASK).catch(
    () => false,
  );
  const started = await startBackgroundPing(clockIn.slice(0, 5));
  if (started && (!wasRunning || opsi.forceCatchUp)) {
    /**
     * `forceCatchUp` HANYA disetel oleh jalur pulihnya koneksi — listener NetInfo
     * dan watchdog yang melihat `recovered`. Jadi ia sekaligus jawaban untuk
     * "apakah fix ini diambil karena koneksinya baru kembali?", dan servernya
     * memakai jawaban itu untuk melepaskan ping ini dari jeda 3 jam.
     *
     * Cabang offline di atas memakai `force: true` juga, tapi TIDAK menandainya
     * reconnect — di sana servernya justru sedang tidak bisa dihubungi.
     */
    await catchUpPing({
      force: opsi.forceCatchUp,
      reconnect: opsi.forceCatchUp,
    });
  }
}

TaskManager.defineTask(WATCHDOG_TASK, async () => {
  try {
    const koneksi = await checkConnectivityNow("background");
    await reconcileBackgroundPingFromServer({ forceCatchUp: koneksi.recovered });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn("[ping] watchdog gagal", (error as Error).message);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Pemantau koneksi dipasang di MODULE SCOPE, bukan di dalam React.
 *
 * Alasannya sama dengan `TaskManager.defineTask` di atas, dan sama pentingnya:
 * OS boleh menjalankan bundel ini tanpa satu pun komponen ter-mount — untuk
 * mengantar lokasi latar belakang atau menjalankan watchdog — dan pendaftaran
 * yang hidup di dalam `useEffect` tidak pernah terjadi di jalur itu. Sebelumnya
 * pendaftarannya ada di `_layout.tsx`, jadi deteksi koneksi (dan ping susulan
 * yang dipicunya) hanya hidup selama ada pohon React yang me-mount-nya.
 *
 * Di Android, selama karyawan absen masuk ada layanan latar depan lokasi yang
 * menahan proses ini tetap hidup — jadi listener ini benar-benar berbunyi saat
 * aplikasi di latar belakang, layar mati, atau pengguna berada di aplikasi lain.
 * Ketika prosesnya akhirnya mati, watchdog 15 menit dan notifikasi yang sudah
 * dijadwalkan ke OS yang mengambil alih.
 *
 * Nilai kembaliannya (fungsi pembatal) sengaja dibuang: masa hidup pemantau ini
 * MEMANG masa hidup konteks JS-nya, dan tidak ada momen di mana ia layak
 * dihentikan lebih awal.
 */
let pemantauKoneksi = false;
export function ensureConnectivityMonitor() {
  if (pemantauKoneksi) return;
  pemantauKoneksi = true;
  try {
    startConnectivityMonitor(() =>
      reconcileBackgroundPingFromServer({ forceCatchUp: true }).catch((error) =>
        console.warn(
          "[ping] gagal mengirim susulan setelah koneksi pulih",
          (error as Error).message,
        ),
      ),
    );
  } catch (error) {
    // modul native yang belum siap tidak boleh menjatuhkan peluncuran aplikasi
    pemantauKoneksi = false;
    console.warn("[koneksi] pemantau gagal dipasang", (error as Error).message);
  }
}

ensureConnectivityMonitor();

/**
 * Watchdog dipasang ulang dari MODULE SCOPE, alasannya sama persis dengan
 * pemantau koneksi di atas: satu-satunya pemanggil lain ada di dalam efek
 * `_layout.tsx`, dan efek itu butuh pohon React yang ter-mount — hal yang justru
 * TIDAK ada pada peluncuran headless.
 *
 * Kenapa tidak cukup sekali seumur pemasangan: di Android O+ rantainya
 * `OneTimeWorkRequest` yang mengantrekan penggantinya sendiri di akhir tiap
 * jalannya. Satu mata rantai yang putus — task yang belum terdefinisi, WorkManager
 * yang dibersihkan sistem — tidak pernah tersambung lagi sampai ada yang membuka
 * aplikasinya. Ini yang menyambungnya di tiap peluncuran, termasuk yang tanpa
 * layar.
 *
 * Digerbangi cookie, bukan tanpa syarat: logout memanggil `stopBackgroundWatchdog`,
 * dan menyalakannya lagi di tiap peluncuran berarti menghidupkan kembali apa yang
 * baru saja dimatikan. Sesudah logout SESSION_KEY sudah tidak ada, jadi cabang ini
 * diam. `isTaskRegisteredAsync` di dalam ensureBackgroundWatchdog yang membuat
 * pemanggilan berulang ini murah.
 */
void SecureStore.getItemAsync(SESSION_KEY)
  .then((cookie) => (cookie ? ensureBackgroundWatchdog() : false))
  .catch((error) =>
    console.warn("[ping] watchdog gagal dipasang ulang", (error as Error).message),
  );

if (__DEV__) {
  const yakin = (got: string | null, want: string | null, apa: string) => {
    if (got !== want) throw new Error(`masukTersimpan ${apa}: ${got} ≠ ${want}`);
  };
  // bentuk yang dikembalikan bacaStatus() untuk kunci yang tidak ada
  yakin(masukTersimpan(["", null]), null, "belum pernah absen masuk");
  yakin(masukTersimpan(["", 123]), null, "kunci kosong dengan jejak ping");
  yakin(masukTersimpan(["08:02", null]), "08:02", "sedang clock in");
  yakin(masukTersimpan(["08:02", 123]), "08:02", "clock in dengan ping terakhir");
}
