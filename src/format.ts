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
export function jamWib(withSeconds = false, at: Date | number = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(at);
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
/**
 * Sejauh apa pengajuan cuti boleh menyebut tanggal yang sudah lewat.
 *
 * CERMIN dari `MAKS_MUNDUR_HARI` di web/src/lib/hr.ts, yang menegakkannya di
 * server. Angka ini hanya membatasi pemilih tanggal supaya orang tidak memilih
 * hari yang pasti ditolak; kalau keduanya berbeda, yang berlaku tetap yang di
 * server — dan yang salah adalah yang di sini.
 */
export const MAKS_MUNDUR_HARI = 30;

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

/**
 * Terlambat / pulang cepat — cermin `attendanceStatus` dan `pulangCepat` di
 * web/src/lib/hr.ts.
 *
 * Ada di sini untuk alasan yang sama seperti `jarakMeter` di atas: supaya field
 * "alasan" muncul dan tombolnya mati SEBELUM permintaan yang pasti ditolak
 * dikirim. Yang menentukan tetap /api/me/clock, yang tidak bisa dibujuk telepon
 * ini — kalau keduanya berbeda pendapat, servernya yang menang dan pesannya
 * yang tampil.
 */
export function terlambat(sekarang: string, shiftStart: string, toleransi: number) {
  const m = (t: string) => {
    const [h, min] = t.split(":").map(Number);
    return (h || 0) * 60 + (min || 0);
  };
  return m(sekarang) > m(shiftStart) + toleransi;
}

/** Keluar sebelum shiftnya selesai. Sisanya harus lebih dari nol dan tidak lebih
 *  panjang dari shiftnya — batas kedua yang membedakan "sejam lebih awal" dari
 *  "sejam lembur", yang tanpa itu terbaca 23 jam lebih awal. */
export function pulangCepat(
  sekarang: string,
  shift: { start: string; end: string },
) {
  const sisa = menitAntara(sekarang, shift.end);
  return sisa > 0 && sisa <= menitAntara(shift.start, shift.end);
}

export function menitAntara(startTime: string, endTime: string) {
  const m = (t: string) => {
    const [h, min] = t.split(":").map(Number);
    return (h || 0) * 60 + (min || 0);
  };
  const diff = m(endTime) - m(startTime);
  return diff >= 0 ? diff : diff + 24 * 60;
}

/**
 * Menit kerja hari ini: dari absen masuk sampai absen keluar, atau sampai
 * `sekarang` kalau harinya masih berjalan. Nol kalau belum absen masuk — bukan
 * negatif dan bukan NaN, karena angka ini jadi pembilang cincin di Beranda.
 *
 * Pembungkusan tengah malam diserahkan ke `menitAntara` di atas: satpam yang
 * masuk 22:00 dan keluar 06:00 bekerja delapan jam, bukan minus enam belas.
 * Penyebutnya — panjang shift — juga `menitAntara(shift.start, shift.end)`,
 * jadi tidak ada fungsi kedua yang menghitung hal yang sama.
 */
export function menitKerja(
  clockIn: string | null,
  clockOut: string | null,
  sekarang: string = jamWib(),
): number {
  return clockIn ? menitAntara(clockIn, clockOut ?? sekarang) : 0;
}

if (__DEV__) {
  const eq = (got: number, want: number, apa: string) => {
    if (got !== want) throw new Error(`${apa}: ${got} ≠ ${want}`);
  };
  eq(menitKerja(null, null, "13:00"), 0, "belum absen");
  eq(menitKerja("08:00", "17:00"), 540, "hari selesai");
  eq(menitKerja("08:00", null, "11:30"), 210, "masih berjalan");
  // absen keluar sesudah tengah malam: 22:00 → 06:00 itu delapan jam
  eq(menitKerja("22:00:00", "06:00:00"), 480, "lintas tengah malam");
  // kolom `time` Postgres membawa detik; keduanya harus mengabaikannya
  eq(menitKerja("08:05:30", "08:35:00"), 30, "detik diabaikan");
  eq(menitAntara("08:00", "17:00"), 540, "panjang shift siang");
  eq(menitAntara("22:00", "06:00"), 480, "panjang shift malam");
  const yakin = (got: boolean, want: boolean, apa: string) => {
    if (got !== want) throw new Error(`${apa}: ${got} ≠ ${want}`);
  };
  // cermin hr.check.ts: 08:00 + toleransi 15
  yakin(terlambat("08:15", "08:00", 15), false, "tepat di batas toleransi");
  yakin(terlambat("08:16", "08:00", 15), true, "lewat toleransi");
  yakin(terlambat("07:52", "08:00", 15), false, "datang lebih awal");
  const siang = { start: "08:00", end: "17:00" };
  const malam = { start: "22:00", end: "06:00" };
  yakin(pulangCepat("17:00", siang), false, "tepat akhir shift");
  yakin(pulangCepat("16:00", siang), true, "sejam lebih awal");
  yakin(pulangCepat("18:30", siang), false, "lembur, bukan pulang cepat");
  yakin(pulangCepat("05:00", malam), true, "shift malam lebih awal");
  yakin(pulangCepat("07:00", malam), false, "shift malam lembur");
}

/** "0858-8182-0410". Same grouping as the web's lib/hr.ts — duplicated rather
 *  than shared because mobile deliberately imports nothing from web/ (§10). */
export function telepon(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "");
  if (!d) return "—";
  return d.match(/.{1,4}/g)!.join("-");
}

/** "11 Agustus 2002", or "—" when the field was never filled in. */
export function tanggalOrDash(iso: string | null | undefined) {
  if (!iso || !isIsoDate(iso)) return "—";
  const d = utc(iso);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whole years since a birth date. */
export function umur(iso: string | null | undefined, today = todayWib()) {
  if (!iso || !isIsoDate(iso)) return null;
  const b = utc(iso);
  const t = utc(today);
  let years = t.getUTCFullYear() - b.getUTCFullYear();
  const md = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  if (md(t) < md(b)) years--;
  return years;
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isJam = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
