import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
import { Loading } from "@/ui";
import { tamaguiConfig } from "../../tamagui.config";

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

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <Theme name={scheme}>
        <SafeAreaProvider>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Gate loading={loading || !ready} cookie={cookie} pathname={pathname} />
        </SafeAreaProvider>
      </Theme>
    </TamaguiProvider>
  );
}

/**
 * Route guard. Kept inside the providers so the spinner and the redirect are
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
  if (loading) {
    return (
      <YStack flex={1} backgroundColor="$bg" justifyContent="center">
        <Loading />
      </YStack>
    );
  }

  const onLogin = pathname === "/login";
  if (!cookie && !onLogin) return <Redirect href="/login" />;
  if (cookie && onLogin) return <Redirect href="/" />;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </QueryClientProvider>
  );
}
