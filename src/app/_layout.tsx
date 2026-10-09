import { useCallback, useEffect, useRef } from "react";
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
  catchUpPing,
  clearQueue,
  ensureBackgroundWatchdog,
  ensureConnectivityMonitor,
  masukTerakhir,
  startBackgroundPing,
  stopBackgroundPing,
  stopBackgroundWatchdog,
} from "@/background-ping";
// side-effect import: hands expo-linear-gradient to Tamagui's <LinearGradient>.
// Without it the native wrapper returns undefined instead of a component, which
// React treats as a render error and Android reports as a force close — see the
// Beranda header gradient.
import "@tamagui/native/setup-expo-linear-gradient";
import { ApiError, type Bootstrap, get, useSession } from "@/api";
import { IzinLokasi, useIzinLokasi } from "@/izin-lokasi";
import { IzinNotifikasi } from "@/izin-notifikasi";
import { lepasPengawas } from "../../modules/pengawas-jaringan";
import { usePrefs } from "@/prefs";
import { dark, light, tamaguiConfig } from "../../tamagui.config";
import { backfillNamaTempat } from "@/backfill-tempat";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry a transient server failure once, but never repeat a request that
      // already spent 12 seconds timing out or has no network route.
      retry: (failureCount, error) =>
        failureCount < 1 && error instanceof ApiError && error.status >= 500,
      retryDelay: 750,
      staleTime: 2 * 60_000,
      gcTime: 2 * 60_000,
      // Several mounted guards consume the same bootstrap. Refetching it for
      // every observer made one cold start issue back-to-back /api/me requests.
      refetchOnMount: true,
      refetchOnWindowFocus: false,
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

  // Pemantau koneksi TIDAK didaftarkan di sini lagi. Ia dipasang di module scope
  // background-ping.ts, karena OS boleh menjalankan bundel ini tanpa satu pun
  // komponen ter-mount — dan pendaftaran yang hidup di dalam useEffect membuat
  // deteksi offline bergantung pada adanya layar yang sedang dirender.

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
        {/* pintu masuk App Links; ia hanya memetakan lalu me-redirect */}
        <Stack.Screen name="buka/[tujuan]" />
      </Stack>
    </>
  );

  /**
   * Izin notifikasi diminta sesudah login, bukan sebelumnya: onboarding dan layar
   * login sampai di baris ini juga (tanpa cookie), dan menghadang orang dengan
   * permintaan izin untuk aplikasi yang belum pernah ia lihat isinya hanya
   * memperbesar angka penolakan — sedangkan penolakan di Android 13 itu permanen.
   *
   * Keduanya merender <Stack> hanya kalau izinnya ada, bukan me-redirect ke sebuah
   * rute, jadi tidak ada halaman di belakangnya yang bisa dituju deep link.
   *
   * Notifikasi dulu, lokasi kemudian: yang pertama dijawab satu ketukan, yang kedua
   * mengantar ke Pengaturan sistem. Menaruh yang panjang di depan membuat orang
   * bolak-balik ke Pengaturan sebelum sempat melihat aplikasinya sekali pun.
   */
  return cookie ? (
    <IzinNotifikasi>
      <IzinLokasi>{isi}</IzinLokasi>
    </IzinNotifikasi>
  ) : (
    isi
  );
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
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
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
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
    enabled: Boolean(cookie),
  });
  const clockedIn = Boolean(
    cookie && me.data?.today.clockIn && !me.data.today.clockOut,
  );
  // izin yang baru diberikan harus menyalakan layanannya saat itu juga, bukan pada
  // peluncuran berikutnya — lihat komentar di useIzinLokasi
  const bolehLokasi = useIzinLokasi((s) => s.boleh);

  /**
   * Satu fungsi, dua pemanggil: efek di bawah (peluncuran dan tiap perubahan
   * keadaan absen) dan listener AppState. Dipakai bersama karena keduanya menjawab
   * pertanyaan yang sama — "apakah layanannya seharusnya hidup sekarang?" — dan
   * karena izin lokasi bisa berubah di Pengaturan sistem tanpa satu pun state React
   * di sini ikut berubah: tanpa jalur AppState, izin yang baru saja diberikan tidak
   * akan menyalakan apa pun sampai aplikasinya ditutup dan dibuka lagi.
   */
  const rukun = useCallback(async () => {
    // `clockedIn` is false while the bootstrap is pending. Treating that as real
    // attendance state stopped an existing Android service, then started it again
    // a moment later and immediately requested GPS — expensive churn at launch.
    if (cookie && !me.data) {
      // masih memuat: jangan sentuh apa pun
      if (!me.isError) return;
      /**
       * Bootstrap-nya GAGAL, bukan sedang berjalan — praktisnya: tidak ada
       * jaringan. Menyerah di sini berarti membuka aplikasi di tempat tanpa
       * sinyal sesudah force-stop tidak memulihkan apa pun, padahal membuka
       * aplikasi adalah satu-satunya pemulihan yang Android sediakan.
       *
       * Jadi keadaan terakhir yang diketahui yang dipakai: kalau jam masuk masih
       * tersimpan, layanannya dinyalakan dan satu fix diambil dari GPS (yang
       * tidak butuh jaringan) untuk diantre — persis seperti cabang offline di
       * reconcileBackgroundPingFromServer.
       */
      const masuk = await masukTerakhir();
      if (!masuk) return;
      if (await startBackgroundPing(masuk)) await catchUpPing();
      return;
    }
    if (!clockedIn) {
      await stopBackgroundPing();
      if (!cookie) await clearQueue();
      return;
    }
    /**
     * Dipanggil tanpa syarat, bukan hanya ketika izinnya belum ada.
     * `canPingInBackground()` hanya membaca IZIN, sedangkan yang perlu dipastikan
     * adalah LAYANANNYA hidup — dan sesudah force-stop izinnya masih ada
     * sementara layanannya sudah mati. Menjadikan izin sebagai penjaga berarti
     * satu-satunya kasus yang paling perlu dipulihkan justru dilewati.
     *
     * Aman diulang: startBackgroundPing berhenti lebih awal kalau task-nya sudah
     * jalan, dan yang tersisa hanya menyegarkan kalimat di notifikasi.
     *
     * Tidak ada toast saat izinnya belum ada: IzinLokasi yang menangani percakapan
     * itu, dengan layar yang bisa ditindaklanjuti — toast di belakang gerbangnya
     * hanya mengulang keluhan tanpa menawarkan jalan keluar.
     */
    if (!(await startBackgroundPing(me.data?.today.clockIn?.slice(0, 5) ?? "")))
      return;
    // Peluncuran dingin tidak pernah memicu AppState "change" — keadaannya sudah
    // aktif sejak awal. Tanpa baris ini, membuka aplikasi setelah force-stop
    // hanya menyalakan ulang penjadwalnya dan menunggu tiga jam lagi.
    await catchUpPing();
  }, [clockedIn, cookie, me.data, me.isError, me.data?.today.clockIn, bolehLokasi]);

  useEffect(() => {
    // Kesempatan kedua, bukan pengulangan berkala: pemasangan di module scope bisa
    // gagal kalau modul native NetInfo belum siap saat bundelnya dievaluasi — dan
    // tidak ada apa pun yang datang menagihnya lagi, jadi satu kegagalan mematikan
    // deteksi koneksi seumur proses. Di sini semuanya sudah pasti siap, dan
    // panggilan kedua atas pemasangan yang sudah berhasil tidak berbuat apa-apa.
    ensureConnectivityMonitor();
    // Logout must stop tracking immediately. Signed-in reconciliation is not
    // needed for first paint, so leave the JS/native bridge quiet until Beranda
    // has settled.
    if (!cookie) {
      void stopBackgroundWatchdog().catch((error) =>
        console.warn("[ping] gagal menghentikan watchdog", (error as Error).message),
      );
      // Telepon yang sudah tidak dipakai siapa pun tidak perlu mengabari soal
      // koneksi. Dinyalakan lagi oleh startConnectivityMonitor saat ada yang masuk.
      lepasPengawas();
      void rukun().catch((error) =>
        console.warn("[ping] gagal menghentikan pelacakan", (error as Error).message),
      );
      return;
    }
    void ensureBackgroundWatchdog().catch((error) =>
      console.warn("[ping] gagal menyalakan watchdog", (error as Error).message),
    );
    // `isError` ikut membuka jalan: rukun() punya cabang offline sendiri, dan
    // tanpa ini cabang itu tidak akan pernah dipanggil di peluncuran tanpa sinyal
    if (!me.data && !me.isError) return;
    const timer = setTimeout(() => {
      void rukun().catch((error) =>
        console.warn("[ping] gagal menyelaraskan pelacakan", (error as Error).message),
      );
    }, 1_200);
    return () => clearTimeout(timer);
  }, [cookie, me.data, me.isError, rukun]);

  /**
   * Menyusulkan nama tempat untuk ping yang lahir tanpa nama.
   *
   * DI SINI, di dalam pohon React, karena hanya di sinilah aplikasi dipastikan
   * berada di depan — dan geocoder Android baru hidup pada keadaan itu
   * (expo-location mematikannya saat aplikasi ke latar belakang). Menjalankannya
   * dari background-ping tidak akan pernah berhasil.
   *
   * Ditunda sedikit dan tidak pernah dilaporkan ke pengguna: ini pekerjaan
   * kosmetik yang tidak boleh bersaing dengan hal-hal yang dilihat orang saat
   * membuka aplikasi, dan yang gagal cukup dicoba lagi lain kali.
   */
  const susulNamaTempat = useCallback(() => {
    if (!cookie) return;
    setTimeout(() => {
      void backfillNamaTempat().catch((error) =>
        console.warn("[tempat] gagal menyusulkan nama", (error as Error).message),
      );
    }, 2_500);
  }, [cookie]);

  useEffect(() => {
    susulNamaTempat();
  }, [susulNamaTempat]);

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
      // stale saja: kembali dari kamera/dialog izin tidak perlu bootstrap baru
      void qc.refetchQueries({ queryKey: ["me"], stale: true });
      // The fresh query drives the reconciliation effect. Calling `rukun` here
      // too used stale attendance state and duplicated location work whenever a
      // camera/settings activity returned to the app.
      susulNamaTempat();
    });
    return () => sub.remove();
  }, [cookie, qc, susulNamaTempat]);


  return null;
}
