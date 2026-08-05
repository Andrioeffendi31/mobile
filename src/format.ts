/**
 * Display helpers. Anything that decides an outcome — working days, leave
 * balance, late-or-not, distance-within-radius — is computed by the server and
 * only formatted here, so web and mobile can never disagree on a rule
 * (PRD-Mobile §10).
 */

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "Kamis, 30 Juli 2026" */
export function tanggalPanjang(iso: string) {
  const d = utc(iso);
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Juli 2026" from "2026-07" */
export function bulanLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${BULAN[m - 1]} ${y}`;
}

export const hariPendek = (iso: string) => String(utc(iso).getUTCDate()).padStart(2, "0");
export const bulanPendek = (iso: string) => BULAN[utc(iso).getUTCMonth()].slice(0, 3).toUpperCase();

/** The last `count` months as YYYY-MM, newest first — the month picker's options. */
export function bulanTerakhir(count = 12, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Now in WIB, matching the server's clock rather than the phone's timezone. */
export function jamWib(withSeconds = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(new Date());
}

/**
 * Today in WIB as YYYY-MM-DD. Assembled from formatToParts, not from a locale
 * whose short date happens to be ISO: `dateStyle:"short"` follows the device's
 * CLDR data, and on Android builds where en-CA short is `dd/MM/y` this returned
 * "05/08/2026" — which then reached utc() as an Invalid Date and made
 * plusHari() throw on toISOString(), blanking the whole Pengajuan screen.
 */
export const todayWib = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** "Selamat pagi" / "siang" / "malam", by WIB hour. */
export function sapaan() {
  const h = Number(jamWib().slice(0, 2));
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

export const durasiJam = (minutes: number) =>
  `${Math.floor(minutes / 60)}j ${minutes % 60}m`;

/** "24 m" / "1,2 km" — comma decimal, like the rest of the UI. */
export const formatJarak = (meter: number) =>
  meter >= 1000
    ? `${(meter / 1000).toFixed(1).replace(".", ",")} km`
    : `${Math.round(meter)} m`;

/**
 * Distance in metres, haversine. This is only for the sheet's live readout so
 * the button can gray out before a doomed request — the geofence itself is
 * enforced in /api/me/clock, which the phone cannot talk its way past.
 */
export function jarakMeter(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Today + `days`, as YYYY-MM-DD — the date inputs' defaults. */
export function plusHari(days: number, from = todayWib()) {
  const d = utc(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Working days in an inclusive range, weekends only. Preview for the leave
 *  form; the server recounts it against the holiday table, which is where the
 *  number that gets stored comes from. */
export function hariKerjaPreview(start: string, end: string) {
  const a = utc(start);
  const b = utc(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export function menitAntara(startTime: string, endTime: string) {
  const m = (t: string) => {
    const [h, min] = t.split(":").map(Number);
    return (h || 0) * 60 + (min || 0);
  };
  const diff = m(endTime) - m(startTime);
  return diff >= 0 ? diff : diff + 24 * 60;
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isJam = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
