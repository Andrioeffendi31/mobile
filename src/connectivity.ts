import { AppState, Platform } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

const CHANNEL = "connectivity";
const STATE_KEY = "nanumhr.connectivity-state";
/**
 * Satu identifier tetap untuk notifikasi offline.
 *
 * Inilah pencegah duplikat yang paling murah: menjadwalkan ulang dengan
 * identifier yang sama MENGGANTI jadwal sebelumnya, bukan menambah satu lagi.
 * Dan karena identifiernya diketahui, ia bisa dibatalkan saat koneksi pulih.
 */
const NOTIF_ID = "nanumhr-offline";

/**
 * Berapa lama perangkat harus benar-benar terputus sebelum orangnya diberi tahu.
 *
 * KNOB KALIBRASI, bukan angka suci. Lift, basement, dan terowongan memutus
 * koneksi berkali-kali sehari tanpa satu pun jejak yang benar-benar hilang —
 * ping berikutnya masuk antrean dan menyusul sendiri. Notifikasi yang berbunyi
 * di setiap kejadian itu adalah notifikasi yang dimatikan orang, dan yang
 * hilang bersamanya adalah peringatan yang sungguhan.
 *
 * Turunkan kalau HR ingin tahu lebih cepat; naikkan kalau karyawan mengeluh.
 */
const JEDA_OFFLINE_MENIT = 10;
const JEDA_OFFLINE_MS = JEDA_OFFLINE_MENIT * 60_000;

type ConnectivityState = {
  offline: boolean;
  /** kapan episode offline ini pertama kali terlihat; null = sedang online */
  sejak: number | null;
  /**
   * Kapan notifikasinya sudah DISERAHKAN ke penjadwal OS. Bukan "kapan
   * berbunyi": yang membunyikannya adalah alarm milik OS, bisa jadi lama sesudah
   * proses ini mati. Non-null = episode ini sudah punya alarm, jadi jangan
   * menjadwalkan lagi — inilah yang mencegah notifikasi ganda.
   */
  notifiedAt: number | null;
};

/**
 * Kapan episode offline ini dimulai: yang sedang berjalan dipertahankan apa
 * adanya, yang baru dimulai sekarang.
 *
 * Fungsi murni supaya bisa di-assert tanpa NetInfo, tanpa SecureStore, dan
 * tanpa menunggu sepuluh menit.
 */
export function mulaiEpisode(state: ConnectivityState, now: number): number {
  return state.offline && state.sejak !== null ? state.sejak : now;
}

/**
 * Berapa detik lagi notifikasinya harus berbunyi. Minimal 1 detik: penjadwal
 * menolak 0, dan episode yang sudah melewati ambangnya (mis. terdeteksi ulang
 * setelah proses mati 20 menit) harus berbunyi secepat mungkin, bukan diam.
 */
export function detikTunda(sejak: number, now: number): number {
  return Math.max(1, Math.ceil((sejak + JEDA_OFFLINE_MS - now) / 1000));
}

async function bacaState(): Promise<ConnectivityState> {
  const raw = await SecureStore.getItemAsync(STATE_KEY).catch(() => null);
  if (!raw) return { offline: false, sejak: null, notifiedAt: null };
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectivityState>;
    return {
      offline: Boolean(parsed.offline),
      sejak: typeof parsed.sejak === "number" ? parsed.sejak : null,
      notifiedAt: typeof parsed.notifiedAt === "number" ? parsed.notifiedAt : null,
    };
  } catch {
    return { offline: false, sejak: null, notifiedAt: null };
  }
}

async function tulisState(state: ConnectivityState) {
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state)).catch(() => {});
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Status koneksi",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 350, 180, 350],
    lightColor: "#f59e0b",
  });
}

async function bisaMengirimNotif() {
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  return Boolean(
    perm?.granted ||
      perm?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
  );
}

type OfflineSource = "listener" | "request" | "background";

/**
 * Serialisasi baca-ubah-tulis atas satu keadaan di SecureStore.
 *
 * Dalam satu konteks JS, listener NetInfo, AppState, watchdog, dan ping yang
 * gagal bisa tiba nyaris bersamaan; tanpa ini dua di antaranya membaca keadaan
 * yang sama lalu menulisnya berurutan, dan `sejak` milik episode yang sedang
 * berjalan bisa tergeser maju — yang berarti notifikasinya tertunda diam-diam.
 * Satu rantai promise cukup: operasinya pendek dan tidak pernah banyak.
 */
let rantai: Promise<unknown> = Promise.resolve();
function antre<T>(kerja: () => Promise<T>): Promise<T> {
  const hasil = rantai.then(kerja, kerja);
  rantai = hasil.catch(() => {});
  return hasil;
}

/**
 * Offline terlihat: **serahkan notifikasinya ke penjadwal OS sekarang**, jangan
 * menunggu ada kode kita yang berjalan lagi.
 *
 * Ini inti perbaikannya. Sebelumnya panggilan pertama hanya mencatat `sejak`,
 * dan notifikasinya baru dikirim oleh panggilan BERIKUTNYA yang jatuh sesudah
 * ambang. Di latar belakang, satu-satunya yang bisa datang menagih adalah
 * watchdog 15 menit — dan kalau OS sedang menahan jatahnya (Doze, hemat daya,
 * ROM OEM), penagih pertama yang benar-benar datang adalah pengguna yang membuka
 * aplikasinya. Itulah sebabnya notifikasinya terasa "muncul saat layar dibuka":
 * bukan karena butuh layar, tapi karena tidak ada yang lain yang berjalan.
 *
 * Sekarang notifikasinya dijadwalkan satu kali dengan pemicu waktu
 * (`TIME_INTERVAL`, sisa waktu menuju ambang). Yang menyimpan dan membunyikannya
 * adalah Android/iOS, bukan proses kita: layar mati, aplikasi ditutup, atau
 * prosesnya dimatikan sistem — notifikasinya tetap berbunyi pada waktunya. Kalau
 * koneksi pulih lebih dulu, `markInternetConnected()` membatalkannya, jadi lift
 * dan basement tetap tidak menghasilkan bunyi apa pun.
 *
 * Yang TIDAK bisa dijanjikan: sesudah force-stop, Android menahan alarm milik
 * paket yang dihentikan paksa sampai penggunanya membuka aplikasinya sendiri.
 */
export async function notifyInternetDisconnected(source: OfflineSource) {
  await antre(async () => {
    const state = await bacaState();
    const now = Date.now();
    // sudah diserahkan ke OS untuk episode ini — satu notifikasi per episode
    if (state.offline && state.notifiedAt !== null) return;

    const sejak = mulaiEpisode(state, now);
    const detik = detikTunda(sejak, now);

    if (!(await bisaMengirimNotif())) {
      // izin belum ada: catat episodenya saja, biar percobaan berikutnya tetap
      // punya `sejak` yang benar
      await tulisState({ offline: true, sejak, notifiedAt: null });
      return;
    }

    // ditulis LEBIH DULU: dua konteks yang mendeteksi offline bersamaan tidak
    // boleh sama-sama menjadwalkan (identifiernya sama, jadi paling buruk hanya
    // saling mengganti — tapi `sejak` yang ikut tergeser akan menunda bunyinya)
    await tulisState({ offline: true, sejak, notifiedAt: now });
    await ensureChannel();
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: NOTIF_ID,
        content: {
          title: "Internet terputus",
          body:
            source === "request"
              ? "NanumHR belum bisa mengirim data. Data akan dicoba lagi saat koneksi kembali."
              : source === "background"
                ? "NanumHR mendeteksi perangkat offline saat berjalan di latar belakang."
              : "NanumHR mendeteksi perangkat sedang offline. Beberapa data akan menunggu koneksi kembali.",
          data: { route: "/" },
        },
        /**
         * channelId-nya WAJIB disebut: tanpa ini Android memakai channel
         * `default` (importance DEFAULT) dan channel `connectivity` di atas —
         * beserta importance HIGH, getaran, dan warnanya — jadi hiasan belaka.
         */
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: detik,
          repeats: false,
          channelId: CHANNEL,
        },
      });
    } catch {
      // penjadwalan gagal: kembalikan supaya tik berikutnya mencobanya lagi
      await tulisState({ offline: true, sejak, notifiedAt: null });
    }
  });
}

/**
 * Koneksi pulih. Mengembalikan `true` HANYA pada transisi offline → online, dan
 * itulah yang dipakai pemanggilnya sebagai pemicu ping susulan.
 *
 * Sekalian membatalkan notifikasi yang belum berbunyi: pulih sebelum ambang
 * berarti pengguna tidak diganggu sama sekali. Yang sudah tampil ikut
 * disingkirkan — memberi tahu "internet terputus" untuk keadaan yang sudah
 * selesai lebih buruk daripada tidak memberi tahu.
 */
export async function markInternetConnected(): Promise<boolean> {
  return antre(async () => {
    const state = await bacaState();
    if (!state.offline) return false;
    await tulisState({ offline: false, sejak: null, notifiedAt: null });
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID).catch(() => {});
    await Notifications.dismissNotificationAsync(NOTIF_ID).catch(() => {});
    return true;
  });
}

function offline(state: NetInfoState): boolean | null {
  if (state.isConnected === false) return true;
  if (state.isInternetReachable === false) return true;
  if (state.isConnected === true || state.isInternetReachable === true) return false;
  return null;
}

type ConnectivityCheck = {
  offline: boolean | null;
  recovered: boolean;
};

export function startConnectivityMonitor(onReconnect?: () => void | Promise<void>) {
  void checkConnectivityNow("listener").then((hasil) => {
    if (hasil.recovered) void onReconnect?.();
  });

  const net = NetInfo.addEventListener((state) => {
    void (async () => {
      const isOffline = offline(state);
      if (isOffline === true) {
        await notifyInternetDisconnected("listener");
      } else if (isOffline === false && (await markInternetConnected())) {
        await onReconnect?.();
      }
    })();
  });

  const app = AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") {
      void checkConnectivityNow("background").then((hasil) => {
        if (hasil.recovered) void onReconnect?.();
      });
    }
  });

  return () => {
    net();
    app.remove();
  };
}

export async function checkConnectivityNow(
  source: OfflineSource = "background",
): Promise<ConnectivityCheck> {
  const state = await NetInfo.fetch().catch(() => null);
  if (!state) return { offline: null, recovered: false };
  const isOffline = offline(state);
  if (isOffline === true) {
    await notifyInternetDisconnected(source);
    return { offline: true, recovered: false };
  }
  if (isOffline === false) {
    return { offline: false, recovered: await markInternetConnected() };
  }
  return { offline: null, recovered: false };
}

if (__DEV__) {
  const eq = (got: number, want: number, apa: string) => {
    if (got !== want) throw new Error(`${apa}: ${got} ≠ ${want}`);
  };
  const T0 = 1_000_000;
  const menit = (n: number) => T0 + n * 60_000;
  const online = { offline: false, sejak: null, notifiedAt: null };

  // episode baru dimulai sekarang → penuh sepuluh menit
  eq(mulaiEpisode(online, T0), T0, "episode baru");
  eq(detikTunda(mulaiEpisode(online, T0), T0), 600, "tunda episode baru");
  // episode yang sedang berjalan tidak boleh digeser majunya, kalau tidak
  // notifikasinya tertunda tiap kali offline terdeteksi ulang
  const jalan = { offline: true, sejak: T0, notifiedAt: null };
  eq(mulaiEpisode(jalan, menit(3)), T0, "episode berjalan dipertahankan");
  eq(detikTunda(T0, menit(3)), 420, "sisa tujuh menit");
  eq(detikTunda(T0, menit(9.5)), 30, "sisa setengah menit");
  // sudah lewat ambang (proses baru bangun sesudah lama mati) → secepatnya,
  // bukan angka negatif yang akan ditolak penjadwal
  eq(detikTunda(T0, menit(12)), 1, "sudah lewat ambang");
  eq(detikTunda(T0, menit(600)), 1, "jauh melewati ambang");
}
