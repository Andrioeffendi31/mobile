import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The one place that talks to the backend (PRD-Mobile §5).
 *
 * Auth reuses the web app's NextAuth session verbatim: the credentials callback
 * hands back a session cookie, we keep that string and replay it as a `Cookie`
 * header. So `auth()` / `requireUser()` on the server work unchanged for the
 * phone, and there is no second token format to keep in sync.
 *
 * Skipped Axios: one wrapper with a Cookie header and normalised errors is what
 * the interceptors would have been. Add it back the day we need retry policies
 * or request cancellation beyond what TanStack Query already gives.
 */

/** exported so the background location task can read the session without React */
export const SESSION_KEY = "nanumhr.session";

/**
 * Where the API lives. In a dev build there is no baked-in host, so derive it
 * from the Metro server the app was loaded from — the laptop running
 * `npm run dev` in ../web is the same machine. EXPO_PUBLIC_API_URL overrides it
 * for a real build.
 */
function resolveBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
}

export const API = resolveBase();

type SessionState = {
  cookie: string | null;
  /** null while SecureStore is still being read, so the router does not bounce
   *  a logged-in user to /login on the first frame */
  loading: boolean;
  /**
   * Whether the welcome screen has been dismissed for *this* logged-out stretch.
   * Deliberately not persisted and cleared on logout: onboarding introduces the
   * app to whoever is about to sign in, so every sign-out earns it again.
   */
  onboarded: boolean;
  finishOnboarding: () => void;
  set: (cookie: string | null) => Promise<void>;
  restore: () => Promise<void>;
};

export const useSession = create<SessionState>((set) => ({
  cookie: null,
  loading: true,
  onboarded: false,
  finishOnboarding: () => set({ onboarded: true }),
  async set(cookie) {
    if (cookie) await SecureStore.setItemAsync(SESSION_KEY, cookie);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
    set(cookie ? { cookie } : { cookie, onboarded: false });
  },
  async restore() {
    const cookie = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null);
    set({ cookie, loading: false });
  },
}));

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * A cold-start request must never be allowed to live forever. Besides leaving
 * the Beranda on its skeleton, a hanging native fetch keeps its response and
 * React Query observers alive while push/location startup work begins.
 */
const REQUEST_TIMEOUT_MS = 12_000;

type RequestOptions = RequestInit & { timeoutMs?: number };

/** Pull one cookie's `name=value` out of a Set-Cookie response header. Exported
 *  for the passkey flow, which finishes at the same NextAuth callback. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const m = header.match(new RegExp(`${name}=([^;,]+)`));
  return m ? `${name}=${m[1]}` : null;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { cookie } = useSession.getState();
  const controller = new AbortController();
  const upstream = init.signal;
  const abortFromCaller = () => controller.abort();
  if (upstream?.aborted) controller.abort();
  else upstream?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const { timeoutMs: _timeoutMs, ...fetchInit } = init;
    const res = await fetch(`${API}${path}`, {
      ...fetchInit,
      signal: controller.signal,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });

    // an expired or revoked session must drop the app back to /login rather than
    // showing every screen an error at once
    if (res.status === 401) {
      await useSession.getState().set(null);
      throw new ApiError("Sesi berakhir, silakan masuk lagi", 401);
    }

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
    if (!res.ok) {
      throw new ApiError((data as { error?: string }).error ?? "Gagal memuat data", res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Let TanStack Query recognise cancellation caused by an unmounted observer.
    if (upstream?.aborted) throw error;
    if (controller.signal.aborted) {
      throw new ApiError("Server terlalu lama merespons. Coba lagi.", 408);
    }
    throw new ApiError("Tidak dapat terhubung ke server. Periksa koneksi.", 0);
  } finally {
    clearTimeout(timeout);
    upstream?.removeEventListener("abort", abortFromCaller);
  }
}

export const get = <T>(path: string, options: Pick<RequestOptions, "signal" | "timeoutMs"> = {}) =>
  request<T>(path, options);

export const postJson = <T>(path: string, body: unknown, method = "POST") =>
  request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Multipart upload — over XMLHttpRequest, not fetch.
 *
 * Expo SDK 54+ replaces global `fetch` with its WinterCG implementation, and that
 * one only accepts a string, a Blob, or something with `bytes()` as a form part.
 * The React Native `{uri, name, type}` part that a picker hands back throws
 * "Unsupported FormDataPart implementation" (expo/src/winter/fetch/convertFormData.ts).
 *
 * XHR is untouched by that swap — Expo only *patches* RN's FormData, whose
 * `append` still documents the uri form — and it is the better transport anyway:
 * the native layer streams the file straight from disk, where a Blob would have to
 * materialise a 4 MB PDF inside the JS heap first.
 *
 * Kept behaviourally identical to request(): same cookie, same 401 handling, same
 * ApiError shape, so callers cannot tell which transport ran.
 */
export function postForm<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  const { cookie } = useSession.getState();

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API}${path}`);
    xhr.timeout = 30_000;
    if (cookie) xhr.setRequestHeader("cookie", cookie);
    // no content-type header on purpose: XHR derives it from the FormData, and
    // setting it by hand loses the multipart boundary

    xhr.onload = () => {
      const text = xhr.responseText;
      const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);

      if (xhr.status === 401) {
        void useSession.getState().set(null);
        reject(new ApiError("Sesi berakhir, silakan masuk lagi", 401));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError((data as { error?: string }).error ?? "Gagal mengunggah", xhr.status));
        return;
      }
      resolve(data as T);
    };

    xhr.onerror = () => reject(new ApiError("Gagal mengunggah, periksa koneksi", 0));
    xhr.ontimeout = () => reject(new ApiError("Unggahan terlalu lama, coba lagi", 0));

    xhr.send(form);
  });
}

/**
 * Email + password against the same NextAuth credentials provider the web login
 * uses. `X-Auth-Return-Redirect` makes it answer 200 + JSON instead of a 302 —
 * React Native's fetch always follows redirects, and the session cookie would
 * be lost on the hop.
 */
export async function login(email: string, password: string) {
  const csrfRes = await fetch(`${API}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = readCookie(csrfRes.headers.get("set-cookie"), "authjs.csrf-token");

  const body = new URLSearchParams({ csrfToken, email, password });
  const res = await fetch(`${API}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-auth-return-redirect": "1",
      ...(csrfCookie ? { cookie: csrfCookie } : {}),
    },
    body: body.toString(),
  });

  const session = readCookie(res.headers.get("set-cookie"), "authjs.session-token");
  const { url } = (await res.json().catch(() => ({ url: "" }))) as { url?: string };
  if (!session || url?.includes("error=")) {
    throw new ApiError("Email atau kata sandi salah", 401);
  }
  await useSession.getState().set(session);
}

export async function logout() {
  await useSession.getState().set(null);
}

/* ── Response shapes ──────────────────────────────────────────────────────── */

/** A place the employee may punch from, with its own geofence. */
export type Office = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
};

export type Bootstrap = {
  profile: {
    id: number;
    nik: string;
    name: string;
    initials: string;
    division: string;
    position: string;
    role: "hr_admin" | "manager" | "employee";
    photoKey: string | null;
    /** The rest of the employee record, for the Profil screen. Nullable across
     *  the board: the employment half is filled in by HR after the import, and
     *  the personal half has gaps in the source data. */
    email: string;
    birthPlace: string | null;
    birthDate: string | null;
    gender: "Laki-laki" | "Perempuan" | null;
    religion: string | null;
    address: string | null;
    phone: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    contractType: "Tetap" | "Kontrak" | null;
    joinedAt: string | null;
    workLocation: string;
    /** still on the password HR handed out — the app sends them to /ganti-sandi */
    mustChangePassword: boolean;
  };
  today: {
    date: string;
    clockIn: string | null;
    clockOut: string | null;
    status: string;
    location: string | null;
    selfieKey: string | null;
    /** the office chosen at clock-in; clock-out is locked to it */
    officeId: number | null;
    /** izin setengah hari yang disetujui untuk hari ini; `shift` di bawah sudah
     *  ikut digeser oleh jam ini */
    izin: { start: string; end: string } | null;
  };
  /** this employee's division shift, already resolved against the company default */
  shift: { start: string; end: string; toleranceMinutes: number };
  /** every active clock-in point, nearest chosen automatically but overridable */
  offices: Office[];
  /** which one to offer while GPS is still answering; nearest takes over after */
  defaultOfficeId: number | null;
  leave: { remaining: number; quota: number; used: number; expiresAt: string };
  overtime: { minutes: number; capHours: number };
  pendingRequests: number;
  /** credential ids of this account's passkeys, across all devices — the phone
   *  intersects them with the ones it created to tell "this device" apart */
  passkeys: string[];
  announcements: { id: number; title: string; category: string; date: string }[];
  team: {
    total: number;
    present: number;
    /** `name` menyusul dari server; sampai itu terpasang, avatarnya tampil tanpa
     *  nama alih-alih menampilkan tempat kosong */
    avatars: { id: number; initials: string; photoKey: string | null; name?: string }[];
  };
};

/** One day, with the trail behind it — /api/me/attendance/<date>. */
export type AttendanceDay = {
  date: string;
  status: string;
  in: string;
  out: string;
  location: string | null;
  note: string | null;
  selfieKey: string | null;
  shift: { start: string; end: string };
  /** which office the day was measured against; null on a WFH day */
  office: string | null;
  /** pengajuan cuti yang ditolak dan mencakup hari ini — yang membedakan "tidak
   *  pernah minta izin" dari "sudah minta, ditolak, tetap tidak masuk" */
  ditolak: { type: string; startDate: string; endDate: string; note: string | null } | null;
  /** the same office as a point, for the map; null on a WFH day */
  officeGeo: { lat: number; lng: number; radiusM: number } | null;
  /** izin setengah hari yang disetujui untuk hari itu */
  izin: { start: string; end: string } | null;
  /** alasan yang ditulis sendiri di titik absen, wajib saat di luar jamnya */
  lateReason: string | null;
  earlyReason: string | null;
  /** keputusan admin atas alasan di atas; null = belum ditinjau. `ok: true`
   *  berarti `status` di atas sudah terbaca hadir. */
  review: { ok: boolean; note: string | null; at: string | null } | null;
  events: {
    id: number;
    kind: "masuk" | "keluar" | "catatan" | "lokasi";
    at: string;
    location: string | null;
    note: string | null;
    /** kenapa titik ini patut dicurigai (mis. GPS palsu), atau null kalau bersih */
    suspect: string | null;
    /** lubang pada jejak SESUDAH kejadian ini — `tertunda` berarti sebabnya sinyal,
     *  bukan aplikasi yang berhenti berjalan */
    jedaSesudah: { menit: number; tertunda: boolean } | null;
    photoKey: string | null;
    distanceM: number | null;
    /** null on rows written before coordinates were kept */
    lat: number | null;
    lng: number | null;
  }[];
};

export type AttendanceMonth = {
  month: string;
  stats: { hadir: number; telat: number; cuti: number; tanpaKeterangan: number };
  days: {
    date: string;
    status: string;
    in: string;
    out: string;
    note: string;
    selfieKey: string | null;
  }[];
};

export type RequestItem = {
  id: number;
  kind: "cuti" | "lembur";
  title: string;
  detail: string;
  note: string;
  /** `revisi` = sent back by HR, editable by the employee until resubmitted */
  status:
    | "menunggu"
    /** lolos admin, menunggu Pimpinan — hanya cuti yang pernah ke sini */
    | "menunggu_pimpinan"
    | "revisi"
    | "disetujui"
    | "ditolak"
    | "dibatalkan";
  /** cuti only */
  days?: number;
  /** the raw fields, so a revision reopens in the form that created it */
  type?: "Cuti Tahunan" | "Cuti Sakit" | "Izin Khusus" | "Izin Setengah Hari";
  startDate?: string;
  endDate?: string;
  reason?: string;
  delegateId?: number | null;
  delegateName?: string | null;
  createdAt?: string;
  attachment?: { key: string; name: string | null; size: number | null } | null;
  /** lembur only (dan `startTime`/`endTime` juga izin setengah hari) */
  minutes?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  /** cuti only: tanda tangan surat izinnya, dipakai sebagai URL unduhan PDF */
  suratToken?: string;
};

export type Requests = {
  balance: { quota: number; used: number; remaining: number } | null;
  delegates: { id: number; name: string }[];
  cuti: RequestItem[];
  lembur: RequestItem[];
};

export type Team = {
  date: string;
  members: {
    id: number;
    name: string;
    initials: string;
    position: string;
    division: string;
    status: string;
    detail: string;
    photoKey: string | null;
  }[];
};

export type Announcements = {
  items: {
    id: number;
    title: string;
    body: string;
    category: string;
    pinned: boolean;
    author: string;
    date: string;
    /** kunci objek R2 banner, null kalau pengumumannya tanpa gambar. Dilayani
     *  /api/files, yang butuh sesi — jadi gambarnya diminta dengan header cookie,
     *  sama seperti foto profil dan selfie absensi. */
    bannerKey: string | null;
  }[];
};

export type Documents = {
  /** Jatah ruang karyawan ini. Kalimatnya sudah diformat server — sama seperti
   *  `size` di bawah — dan bytenya ikut dikirim karena bar kuota butuh rasionya. */
  storage: {
    usedBytes: number;
    quotaBytes: number;
    terpakai: string;
    kuota: string;
    sisa: string;
  };
  items: {
    id: number;
    name: string;
    ext: string;
    folder: string;
    key: string;
    size: string;
    /** true kalau berkas ini miliknya sendiri — hanya yang ini boleh dihapus */
    mine: boolean;
    uploadedAt: string;
  }[];
};
