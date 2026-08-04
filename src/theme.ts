import { light } from "../tamagui.config";

/**
 * @expo/vector-icons takes a colour string, not a Tamagui token, so the tinted
 * icons resolve their token here. Light values only: an icon inside a coloured
 * chip keeps its hue in either scheme.
 */
export const tint = (token: string) =>
  light[token.replace("$", "") as keyof typeof light] ?? light.fgMuted;

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
  belum_absen: { label: "Belum absen", fg: "$danger", bg: "$dangerSubtle" },
} as const;

export const REQ = {
  menunggu: { label: "Menunggu", fg: "$warning", bg: "$warningSubtle" },
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
 * Deterministic avatar colour — same palette and modulus as the mockup, so one
 * person keeps one colour across web and mobile. Literal hex rather than tokens:
 * these are identity colours, not theme surfaces, and must not flip with the
 * colour scheme.
 */
const AVATAR = ["#4f46e5", "#0f7b5a", "#b4530b", "#1d6fd6", "#7c3aed", "#be185d"];
export const avatarColor = (id: number) => AVATAR[id % AVATAR.length];

/** The gradient behind the Beranda header (mockup: linear-gradient(160deg,…)). */
export const HEADER_GRADIENT = ["#4f46e5", "#6366f1"] as const;
