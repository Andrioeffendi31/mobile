import { light } from "../tamagui.config";

/**
 * @expo/vector-icons takes a colour string, not a Tamagui token, so the tinted
 * icons resolve their token here. Light values only: an icon inside a coloured
 * chip keeps its hue in either scheme.
 */
export const tint = (token: string) =>
  // bukan token: sebuah warna mentah ("#fff") diteruskan apa adanya. Tanpa cabang
  // ini setiap hex yang masuk ke sini diam-diam menjadi abu-abu redup — dan itu
  // persis yang dibutuhkan ubin ikon berlatar solid: glyph putih di atasnya.
  token.startsWith("$")
    ? (light[token.replace("$", "") as keyof typeof light] ?? light.fgMuted)
    : token;

/**
 * Status → theme token, for every badge in the app. Token names, not hex, so a
 * colour has one definition and the dark theme needs no change here.
 */
export const ATT = {
  hadir: { label: "Hadir", fg: "$success", bg: "$successSubtle" },
  telat: { label: "Terlambat", fg: "$warning", bg: "$warningSubtle" },
  wfh: { label: "WFH", fg: "$info", bg: "$infoSubtle" },
  cuti: { label: "Cuti", fg: "$fgMuted", bg: "$inset" },
  izin: { label: "Izin", fg: "$fgMuted", bg: "$inset" },
  sakit: { label: "Sakit", fg: "$info", bg: "$infoSubtle" },
  belum_absen: { label: "Belum absen", fg: "$warning", bg: "$warningSubtle" },
  /** hari kerja yang sudah lewat tanpa absen dan tanpa izin yang disetujui */
  tanpa_keterangan: { label: "Tanpa keterangan", fg: "$danger", bg: "$dangerSubtle" },
  /** bukan hari kerja divisinya, atau libur nasional — bukan tuduhan apa pun */
  libur: { label: "Libur", fg: "$fgMuted", bg: "$inset" },
  /** jatuh sebelum aplikasi mulai mencatat; tidak dinilai, tidak dituduh */
  belum_dicatat: { label: "Belum dicatat", fg: "$fgSubtle", bg: "$inset" },
} as const;

export const REQ = {
  menunggu: { label: "Menunggu", fg: "$warning", bg: "$warningSubtle" },
  /** accent, not warning: "menunggu" is HR's turn and this one is yours */
  revisi: { label: "Perlu revisi", fg: "$accent", bg: "$accentSubtle" },
  /** sudah lolos satu tanda tangan; belum berlaku sampai Pimpinan memutus */
  menunggu_pimpinan: { label: "Menunggu pimpinan", fg: "$info", bg: "$infoSubtle" },
  disetujui: { label: "Disetujui", fg: "$success", bg: "$successSubtle" },
  ditolak: { label: "Ditolak", fg: "$danger", bg: "$dangerSubtle" },
  dibatalkan: { label: "Dibatalkan", fg: "$fgMuted", bg: "$inset" },
} as const;

export const CAT = {
  Kebijakan: { fg: "$accent", bg: "$accentSubtle" },
  Libur: { fg: "$success", bg: "$successSubtle" },
  Administrasi: { fg: "$info", bg: "$infoSubtle" },
  Pelatihan: { fg: "$warning", bg: "$warningSubtle" },
} as const;

export const att = (status: string) => ATT[status as keyof typeof ATT] ?? ATT.belum_absen;
export const req = (status: string) => REQ[status as keyof typeof REQ] ?? REQ.menunggu;
export const cat = (category: string) =>
  CAT[category as keyof typeof CAT] ?? CAT.Administrasi;

/**
 * Pasangan gradien untuk bidang berwarna: ubin ikon, tombol, dan cincin.
 *
 * Terpisah dari token tema dengan sengaja. Token `$success`/`$warning` dipilih
 * untuk **teks dan lencana status**, jadi nilainya diredam supaya terbaca di atas
 * latar terang: `$warning` sesungguhnya cokelat (#b4530b) dan `$success` teal
 * gelap (#0f7b5a). Dipakai sebagai bidang berwarna keduanya tampak kusam —
 * sedangkan rancangannya cerah, dengan glyph putih di atasnya.
 *
 * Digambar `expo-linear-gradient`, yang **sudah terpasang dan sudah ikut di dalam
 * APK** — ia yang dulu melukis header ungu Beranda. Jadi gradien di sini tidak
 * menambah satu paket pun dan tetap bisa dikirim lewat OTA; paket menggambar baru
 * (react-native-svg dan sejenisnya) yang tidak bisa.
 *
 * Terang → gelap, arah kiri-atas ke kanan-bawah, mengikuti rancangan.
 */
export const GRAD = {
  hijau: ["#34d97e", "#16a34a"],
  mint: ["#6ee7b7", "#34c98a"],
  biru: ["#3b82f6", "#2563eb"],
  ungu: ["#8b5cf6", "#7c3aed"],
  indigo: ["#6366f1", "#4f46e5"],
  hadir: ["#6657e8", "#2f91f2"],
  jingga: ["#fb923c", "#ea580c"],
} as const;

/**
 * Deterministic avatar colour — same palette and modulus as the mockup, so one
 * person keeps one colour across web and mobile. Literal hex rather than tokens:
 * these are identity colours, not theme surfaces, and must not flip with the
 * colour scheme.
 */
const AVATAR = ["#4f46e5", "#0f7b5a", "#b4530b", "#1d6fd6", "#7c3aed", "#be185d"];
export const avatarColor = (id: number) => AVATAR[id % AVATAR.length];
