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
export const SESSION_KEY = "ruanghr.session";

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
  set: (cookie: string | null) => Promise<void>;
  restore: () => Promise<void>;
};

export const useSession = create<SessionState>((set) => ({
  cookie: null,
  loading: true,
  async set(cookie) {
    if (cookie) await SecureStore.setItemAsync(SESSION_KEY, cookie);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
    set({ cookie });
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

/** Pull one cookie's `name=value` out of a Set-Cookie response header. Exported
 *  for the passkey flow, which finishes at the same NextAuth callback. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const m = header.match(new RegExp(`${name}=([^;,]+)`));
  return m ? `${name}=${m[1]}` : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { cookie } = useSession.getState();
  const res = await fetch(`${API}${path}`, {
    ...init,
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
}

export const get = <T>(path: string) => request<T>(path);

export const postJson = <T>(path: string, body: unknown, method = "POST") =>
  request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const postForm = <T>(path: string, form: FormData) =>
  request<T>(path, { method: "POST", body: form });

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
  };
  today: {
    date: string;
    clockIn: string | null;
    clockOut: string | null;
    status: string;
    location: string | null;
    selfieKey: string | null;
  };
  shift: { start: string; end: string; toleranceMinutes: number };
  office: { lat: number; lng: number; radiusM: number; label: string };
  leave: { remaining: number; quota: number; used: number; expiresAt: string };
  overtime: { minutes: number; capHours: number };
  pendingRequests: number;
  announcements: { id: number; title: string; category: string; date: string }[];
  team: { total: number; present: number; avatars: { id: number; initials: string }[] };
};

export type AttendanceMonth = {
  month: string;
  stats: { hadir: number; telat: number; cuti: number };
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
  status: "menunggu" | "disetujui" | "ditolak" | "dibatalkan";
  /** cuti only */
  days?: number;
  /** lembur only */
  minutes?: number;
  date?: string;
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
  }[];
};

export type Documents = {
  items: {
    id: number;
    name: string;
    ext: string;
    folder: string;
    key: string;
    size: string;
    mine: boolean;
  }[];
};
