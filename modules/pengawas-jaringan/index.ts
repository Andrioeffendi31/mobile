import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/**
 * Pengawas koneksi yang tidak butuh proses JS tetap hidup.
 *
 * Kenapa harus native. Deteksi offline di JS hanya bekerja selama ada konteks JS
 * yang berjalan — dan di luar jam kerja tidak ada: `expo-location` baru menahan
 * proses tetap hidup lewat foreground service selama karyawannya clock in.
 * Satu-satunya pembangun terjadwal yang tersisa, `expo-background-task`, memasang
 * `NetworkType.CONNECTED` pada work request-nya, jadi ia justru TIDAK PERNAH
 * berjalan saat offline — persis keadaan yang perlu dideteksi.
 *
 * `JobScheduler` dengan `setPersisted(true)` dan tanpa syarat jaringan adalah
 * satu-satunya API Android yang selamat dari matinya proses tanpa menuntut
 * koneksi. Job-nya memeriksa dan memberi tahu sepenuhnya di Kotlin; JS tidak
 * pernah dibangunkan.
 *
 * `requireOptionalNativeModule`, bukan `requireNativeModule`: OTA bisa mendarat
 * di APK yang belum punya modul ini, dan modul yang absen harus menjadi diam,
 * bukan crash saat peluncuran.
 */
type Native = {
  pasang(ambangDetik: number): void;
  lepas(): void;
  tandaiPulih(): void;
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<Native>("PengawasJaringan")
    : null;

/** Apakah APK ini punya pengawas native-nya. Dipakai layar Info untuk berterus terang. */
export const adaPengawasNative = native !== null;

/** Nyalakan pengawasnya. Idempoten — job-nya unik dan dijadwalkan ulang, bukan ditumpuk. */
export function pasangPengawas(ambangDetik: number) {
  native?.pasang(ambangDetik);
}

/** Matikan; dipakai saat logout. */
export function lepasPengawas() {
  native?.lepas();
}

/**
 * Koneksi sudah pulih menurut JS. Membersihkan penanda episode milik Kotlin supaya
 * kedua pihak tidak menghitung episode yang sama dua kali.
 */
export function tandaiPulihNative() {
  native?.tandaiPulih();
}
