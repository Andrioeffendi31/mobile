import { Redirect, useLocalSearchParams, type Href } from "expo-router";

/**
 * Pintu masuk dari tautan email — sisi aplikasi dari App Links.
 *
 * Tautan di email tetap https (Gmail membuang tautan yang bukan http, jadi
 * `nanumhr://` akan mati di sana), dan `android.intentFilters` di app.json
 * membuat Android membukanya di sini alih-alih di browser. Halaman web dengan
 * alamat yang sama tetap ada sebagai cadangan untuk desktop dan ponsel tanpa
 * aplikasi — yang melihatnya hanyalah orang yang memang tidak bisa dibawa ke sini.
 *
 * Cukup pemetaan, tanpa layar sendiri: gerbang sesi dan gerbang izin di _layout
 * sudah berdiri di depan semua rute, jadi tautan yang dibuka dalam keadaan belum
 * login berakhir di layar login — lalu kembali ke sini setelah masuk.
 */
const TUJUAN: Record<string, Href> = {
  absen: "/absen",
  pengajuan: "/pengajuan",
  kehadiran: "/kehadiran",
  // pengumuman tinggal di Beranda; tidak ada layar tersendiri untuknya
  pengumuman: "/",
};

export default function Buka() {
  const { tujuan } = useLocalSearchParams<{ tujuan: string }>();
  return <Redirect href={TUJUAN[tujuan] ?? "/"} />;
}
