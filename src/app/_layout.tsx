import { useEffect, useRef } from "react";
import { useColorScheme } from "react-native";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider, Theme, YStack } from "tamagui";
// side-effect import: TaskManager.defineTask has to run during app init, because
// the OS can launch this bundle headlessly to deliver a background location
import "@/background-ping";
// side-effect import: hands expo-linear-gradient to Tamagui's <LinearGradient>.
// Without it the native wrapper returns undefined instead of a component, which
// React treats as a render error and Android reports as a force close — see the
// Beranda header gradient.
import "@tamagui/native/setup-expo-linear-gradient";
import { useSession } from "@/api";
import { usePrefs } from "@/prefs";
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
  const { cookie, loading, restore } = useSession();
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
    void SystemUI.setBackgroundColorAsync(scheme === "dark" ? dark.bg : light.bg);
  }, [scheme]);

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
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Gate loading={loading || !ready} cookie={cookie} pathname={pathname} />
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
  pathname,
}: {
  loading: boolean;
  cookie: string | null;
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

  const onLogin = pathname === "/login";
  if (!cookie && !onLogin) return <Redirect href="/login" />;
  if (cookie && onLogin) return <Redirect href="/" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
