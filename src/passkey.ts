import { Platform } from "react-native";
import { Passkey } from "react-native-passkey";
import { API, ApiError, get, postJson, readCookie, useSession } from "@/api";

/**
 * Passkey sign-in and enrolment (PRD-Mobile §7).
 *
 * The same backend serves web and mobile: `react-native-passkey` runs the OS
 * ceremony (Face ID / Touch ID / fingerprint) and produces exactly the WebAuthn
 * payload the browser would, so `/api/webauthn/*` and the NextAuth `passkey`
 * provider are used unchanged. The only server-side concession is accepting the
 * Android `apk-key-hash:` origin alongside the web one.
 *
 * Requires a development/EAS build — and the domain must publish
 * /.well-known/apple-app-site-association (iOS) or /.well-known/assetlinks.json
 * (Android), which is why `available()` also refuses plain-HTTP hosts: a passkey
 * cannot be bound to `http://192.168.x.x:3000`.
 */

type Options = {
  challenge: string;
  rpId?: string;
  rp?: { id: string; name: string };
  [key: string]: unknown;
};

/** Whether offering the passkey button makes sense on this device and host. */
export function available() {
  return Passkey.isSupported() && API.startsWith("https://");
}

/** The host is the relying party, so it is also the rpId the OS binds to. */
const rpIdFromApi = () => new URL(API).hostname;

/**
 * Sign in with a passkey. Mirrors login(): NextAuth answers 200 + JSON when asked
 * with X-Auth-Return-Redirect, because React Native's fetch always follows
 * redirects and the session cookie would be lost on the hop.
 */
export async function loginWithPasskey() {
  const { options, challengeId } = await get<{ options: Options; challengeId: string }>(
    "/api/webauthn/login",
  );

  const assertion = await Passkey.get({
    challenge: options.challenge,
    rpId: options.rpId ?? rpIdFromApi(),
    userVerification: "preferred",
  });

  const csrfRes = await fetch(`${API}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = readCookie(csrfRes.headers.get("set-cookie"), "authjs.csrf-token");

  const res = await fetch(`${API}/api/auth/callback/passkey`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-auth-return-redirect": "1",
      ...(csrfCookie ? { cookie: csrfCookie } : {}),
    },
    body: new URLSearchParams({
      csrfToken,
      challengeId,
      // the provider parses this string itself, so the shape must survive verbatim
      response: JSON.stringify(assertion),
    }).toString(),
  });

  const session = readCookie(res.headers.get("set-cookie"), "authjs.session-token");
  const { url } = (await res.json().catch(() => ({}))) as { url?: string };
  if (!session || url?.includes("error=")) {
    throw new ApiError("Passkey tidak dikenali. Coba masuk dengan kata sandi.", 401);
  }
  await useSession.getState().set(session);
}

/**
 * Enrol this device's biometric as a passkey. Needs an existing session — you
 * prove who you are with the password once, then bind the device (PRD §7).
 */
export async function enrollPasskey() {
  const { options, challengeId } = await get<{ options: Options; challengeId: string }>(
    "/api/webauthn/register",
  );

  const attestation = await Passkey.create({
    ...(options as unknown as Parameters<typeof Passkey.create>[0]),
    rp: options.rp ?? { id: rpIdFromApi(), name: "Ruang HR" },
  });

  await postJson("/api/webauthn/register", {
    challengeId,
    response: attestation,
    label: Platform.OS === "ios" ? "iPhone (Face ID)" : "Android (biometrik)",
  });
}
