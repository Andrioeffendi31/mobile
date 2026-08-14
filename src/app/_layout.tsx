import { useEffect, useRef } from "react";
import { AppState, useColorScheme } from "react-native";
import { Redirect, Stack, usePathname, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TamaguiProvider, Theme, YStack } from "tamagui";
// Importing this module at all is what runs TaskManager.defineTask, and that has
// to happen during app init: the OS can launch this bundle headlessly to deliver
// a background location, with no React tree mounted to do it later.
import {
  canPingInBackground,
  catchUpPing,
  clearQueue,
  startBackgroundPing,
  stopBackgroundPing,
} from "@/background-ping";
// side-effect import: hands expo-linear-gradient to Tamagui's <LinearGradient>.
// Without it the native wrapper returns undefined instead of a component, which
// React treats as a render error and Android reports as a force close — see the
// Beranda header gradient.
import "@tamagui/native/setup-expo-linear-gradient";
import { type Bootstrap, get, useSession } from "@/api";
import { IzinNotifikasi } from "@/izin-notifikasi";
import { usePrefs } from "@/prefs";
import { toast } from "@/toast";
import { dark, light, tamaguiConfig } from "../../tamagui.config";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // a phone loses signal in lifts and basements; one silent retry beats an
      // error card the user has to tap through
      retry: 1,
      staleTime: 30_000,
      refetchOnMount: "always",
    },
    // a 401 clears the session and bounces to /login, so a retried mutation
    // would only replay a request that can no longer succeed
    mutations: { retry: 0 },
  },
});

export default function RootLayout() {
  // useColorScheme can also answer "unspecified"; only the two themes exist
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const { theme, ready } = usePrefs();
  const scheme = theme === "system" ? system : theme;
  const { cookie, loading, onboarded, restore } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    void restore();
  }, [restore]);

  /**
   * The native window colour behind React's view tree. Without this it keeps the
   * colour it was launched with, and every gap the tree does not paint — the
   * frame before the first render, the strip behind a screen transition, the
   * area under a dismissing sheet — flashes the other theme.
   */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(
      pathname === "/onboarding"
        ? scheme === "dark"
          ? "#101827"
          : "#f4f7fb"
        : scheme === "dark"
          ? dark.bg
          : light.bg,
    );
  }, [pathname, scheme]);

  /**
   * QueryClientProvider outermost, above TamaguiProvider.
   *
   * It used to sit inside <Gate>, wrapping only the <Stack>. That looks equivalent
   * and is not: a modal <Sheet> does not render its children where they were
   * written. Tamagui's native portal is not a React portal — it stores the node in
   * the PortalProvider's state and re-renders it from a <PortalHost> mounted up at
   * the root, so React context is resolved from *there*. Any hook inside a sheet —
   * the attachment download, anything added later — looked for a QueryClient
   * outside the one place that had one, and threw.
   */
  return (
    <QueryClientProvider client={queryClient}>
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <Theme name={scheme}>
        <SafeAreaProvider>
          <StatusBar
            style={scheme === "dark" ? "light" : "dark"}
          />
          <Gate
            loading={loading || !ready}
            cookie={cookie}
            onboarded={onboarded}
            pathname={pathname}
          />
          <Trail cookie={cookie} />
          <SchemeFade scheme={scheme} />
        </SafeAreaProvider>
      </Theme>
    </TamaguiProvider>
    </QueryClientProvider>
  );
}

/**
 * Cross-fade over a theme change.
 *
 * A colour scheme cannot be animated on native: every view re-reads its theme in
 * whichever frame it happens to re-render, so a flip is a scatter of repaints
 * rather than one — and the components that re-render first (anything watching
 * the preference store, which is what the theme switcher itself does) land a
 * frame or two ahead of the rest.
 *
 * So the change is covered instead of animated: a full-screen pane in the *new*
 * background colour mounts opaque and fades away, which is both the smooth
 * transition and the thing that hides the scatter underneath it. Keyed by scheme
 * so each change gets a fresh mount, `pointerEvents` off so it never eats a tap,
 * and skipped on first paint — there is nothing to fade from at launch.
 */
function SchemeFade({ scheme }: { scheme: "light" | "dark" }) {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, [scheme]);

  if (first.current) return null;

  return (
    <YStack
      key={scheme}
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      left={0}
      backgroundColor="$bg"
      pointerEvents="none"
      // medium, not slow: the scatter it covers is one or two frames, and `slow`
      // is damped hard enough (45/60) to read as the app hanging
      transition="medium"
      enterStyle={{ opacity: 1 }}
      opacity={0}
    />
  );
}

/**
 * Route guard. Kept inside the providers so the placeholder and the redirect are
 * already themed — and so SecureStore's async read cannot flash /login at an
 * employee who is in fact signed in.
 */
function Gate({
  loading,
  cookie,
  onboarded,
  pathname,
}: {
  loading: boolean;
  cookie: string | null;
  onboarded: boolean;
  pathname: string;
}) {
  /**
   * No skeleton and no spinner: this is a SecureStore read that finishes in a
   * frame or two, and the screen it is deciding between is /login or the tabs.
   * A skeleton of either would be a guess that flashes the wrong shape half the
   * time — a themed background is the honest placeholder for "we do not know yet
   * what goes here".
   */
  if (loading) return <YStack flex={1} backgroundColor="$bg" />;

  const onOnboarding = pathname === "/onboarding";
  const onLogin = pathname === "/login";
  // Onboarding belongs to the signed-out state: every logout clears `onboarded`,
  // so the welcome screen leads into the login screen again.
  // The generated typed-route declaration is refreshed by Metro after a new
  // route file appears; the cast keeps a clean standalone `tsc` run before that.
  if (!cookie && !onboarded && !onOnboarding) {
    return <Redirect href={"/onboarding" as Href} />;
  }
  if ((cookie || onboarded) && onOnboarding) {
    return <Redirect href={cookie ? "/" : "/login"} />;
  }
  // …and only after it: without the guard /onboarding bounces to /login and the
  // check above bounces it straight back, forever
  if (!cookie && !onLogin && !onOnboarding) return <Redirect href="/login" />;
  if (cookie && onLogin) return <Redirect href="/" />;

  const isi = (
    <>
      <SandiGate cookie={cookie} pathname={pathname} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="ganti-sandi" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );

  /**
   * Izin notifikasi diminta sesudah login, bukan sebelumnya: onboarding dan layar
   * login sampai di baris ini juga (tanpa cookie), dan menghadang orang dengan
   * permintaan izin untuk aplikasi yang belum pernah ia lihat isinya hanya
   * memperbesar angka penolakan — sedangkan penolakan di Android 13 itu permanen.
   *
   * IzinNotifikasi merender <Stack> hanya kalau izinnya ada, bukan me-redirect ke
   * sebuah rute, jadi tidak ada halaman di belakangnya yang bisa dituju deep link.
   */
  return cookie ? <IzinNotifikasi>{isi}</IzinNotifikasi> : isi;
}

/**
 * An account still on the password HR handed out at the import gets no further
 * than the screen that replaces it.
 *
 * Split out of Gate rather than folded into it, because it must not block: this
 * reads the same ["me"] query every tab already issues, so it costs no extra
 * request, but it answers a frame or two later than the session cookie does.
 * Rendering the Stack meanwhile and redirecting when the answer arrives keeps
 * launch instant for the 99% who have already chosen their own password.
 */
function SandiGate({
  cookie,
  pathname,
}: {
  cookie: string | null;
  pathname: string;
}) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => get<Bootstrap>("/api/me"),
    enabled: Boolean(cookie),
  });

  if (!me.data?.profile.mustChangePassword) return null;
  if (pathname === "/ganti-sandi") return null;
  return <Redirect href={"/ganti-sandi" as Href} />;
}

/**
 * Menyalakan dan mematikan jejak lokasi bersama hari kerja.
 *
 * Dulu efek ini tinggal di tab Beranda, yang berarti ia hanya berjalan kalau tab
 * itu kebetulan ter-mount — sebuah kebetulan routing, bukan jaminan. Di sini ia
 * berjalan pada setiap peluncuran, dan sengaja BERADA DI LUAR `Gate`: ia harus
 * tetap hidup ketika cookie menjadi null, karena logout adalah salah satu momen
 * yang wajib menghentikan layanannya. Sebelum ini, ponsel yang sudah logout masih
 * menampilkan notifikasi "NanumHR mencatat lokasi" sampai wake-up berikutnya.
 *
 * Menghentikannya di sini, bukan di dalam `keluar()` atau `logout()`: yang di sana
 * hanya menutup satu jalan keluar, sedangkan ini menangkap semuanya — termasuk
 * logout otomatis saat sesi ditolak 401 di tengah request.
 */
function Trail({ cookie }: { cookie: string | null }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => get<Bootstrap>("/api/me"),
    enabled: Boolean(cookie),
  });
  const clockedIn = Boolean(
    cookie && me.data?.today.clockIn && !me.data.today.clockOut,
  );

  useEffect(() => {
    let batal = false;
    (async () => {
      if (!clockedIn) {
        await stopBackgroundPing();
        if (!cookie) await clearQueue();
        return;
      }
      if (!(await canPingInBackground())) {
        const ok = await startBackgroundPing();
        if (!ok && !batal) {
          toast("Izin lokasi latar belakang ditolak · jejak lokasi tidak tercatat");
          return;
        }
      }
      // Peluncuran dingin tidak pernah memicu AppState "change" — keadaannya sudah
      // aktif sejak awal. Tanpa baris ini, membuka aplikasi setelah force-stop
      // hanya menyalakan ulang penjadwalnya dan menunggu tiga jam lagi.
      await catchUpPing();
    })();
    return () => {
      batal = true;
    };
  }, [clockedIn, cookie]);

  /**
   * Kembali ke depan adalah satu-satunya pemulihan yang tersedia setelah
   * force-stop: Android menaruh paket yang dihentikan paksa dalam keadaan
   * *stopped* dan tidak mengirimkan broadcast apa pun ke sana — termasuk
   * BOOT_COMPLETED — sampai penggunanya membuka aplikasinya sendiri.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !cookie) return;
      // clock-out bisa terjadi di konsol web selagi telepon tidur
      void qc.invalidateQueries({ queryKey: ["me"] });
      void catchUpPing();
    });
    return () => sub.remove();
  }, [cookie, qc]);

  return null;
}
