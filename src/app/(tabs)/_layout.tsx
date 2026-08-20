import { useEffect } from "react";
import { Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Tabs, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { YStack, useTheme } from "tamagui";
import { type Bootstrap, type Requests, get } from "@/api";
import { usePrefs } from "@/prefs";
import { registerForPush, usePushStatus } from "@/push";
import { syncReminders } from "@/reminders";
import { Toast } from "@/toast";

/**
 * The mockup's five tabs. The badge on "Pengajuan" comes from the same
 * bootstrap query the Beranda uses, so opening the app costs one request and
 * both places agree on the count (PRD-Mobile §6.7).
 */
export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
  });
  // Observe the cache without fetching it at startup. The badge appears after
  // Pengajuan has actually been visited or changed.
  const requests = useQuery({
    queryKey: ["requests"],
    queryFn: ({ signal }) => get<Requests>("/api/me/requests", { signal }),
    enabled: false,
  });
  const pendingRequests = [...(requests.data?.cuti ?? []), ...(requests.data?.lembur ?? [])].filter(
    // menunggu_pimpinan ikut terhitung: bagi karyawan ia masih pengajuan yang
    // sedang jalan, hanya sudah lolos satu tanda tangan
    (item) =>
      item.status === "menunggu" ||
      item.status === "menunggu_pimpinan" ||
      item.status === "revisi",
  ).length;
  const bootstrapReady = Boolean(data);

  // registered here rather than on the login screen: this layout is the first
  // thing that only ever renders for a signed-in employee, and it also covers the
  // launch where the session was restored from the keychain without a login.
  // Skipped when the employee turned pemberitahuan off in /pengaturan — asking
  // for the permission again every launch is how that switch becomes a lie.
  const wantsPush = usePrefs((s) => s.push);
  useEffect(() => {
    if (!wantsPush) {
      usePushStatus.setState({ reason: "Dinonaktifkan di Pengaturan" });
      return;
    }
    // Token registration has its own native and network work. It is not needed
    // to draw Home, so never let it compete with the bootstrap request.
    if (!bootstrapReady) return;
    const timer = setTimeout(() => {
      void registerForPush()
        .then((r) => {
          if (!r.ok) console.info("[push] tidak aktif:", r.reason);
        })
        .catch((error) =>
          console.warn("[push] registrasi gagal", (error as Error).message),
        );
    }, 900);
    return () => clearTimeout(timer);
  }, [bootstrapReady, wantsPush]);

  /**
   * Keep the clock-in alarm in step with the shift and today's punches. Driven by
   * the bootstrap because every punch invalidates it, so absen.tsx cancels the
   * rest of today's reminders without knowing this exists.
   */
  const wantsReminder = usePrefs((s) => s.reminder);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => {
      void syncReminders(data).catch((error) =>
        console.warn("[reminder] sinkronisasi gagal", (error as Error).message),
      );
    }, 1_600);
    return () => clearTimeout(timer);
  }, [data, wantsReminder]);

  /** Tapping a notification opens the screen it is about (PRD-Mobile §6.6). */
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const route = tapped?.notification.request.content.data?.route;
    if (typeof route === "string") router.push(route as "/pengajuan");
  }, [tapped, router]);

  return (
    <YStack flex={1}>
    <Tabs
      initialRouteName="index"
      detachInactiveScreens
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        // Cross-fade only: unlike `shift`, this does not translate and composite
        // two long screens across the display. 140 ms is enough to connect both
        // states visually without leaving a heavy scene alive for long.
        animation: "fade",
        transitionSpec: {
          animation: "timing",
          config: {
            duration: 140,
            easing: Easing.out(Easing.quad),
          },
        },
        sceneStyle: { backgroundColor: theme.bg?.val },
        tabBarActiveTintColor: theme.accent?.val,
        tabBarInactiveTintColor: theme.fgSubtle?.val,
        tabBarStyle: {
          backgroundColor: theme.surface?.val,
          borderTopColor: theme.line?.val,
          shadowColor: "#050914",
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -6 },
          // + inset: tanpa ini label "Kehadiran"/"Pengajuan" tertimpa garis gestur
          // Android, dan itu terlihat di tangkapan layar pertama
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
        tabBarActiveBackgroundColor: theme.inset?.val,
        tabBarItemStyle: {
          borderRadius: 15,
          marginHorizontal: 3,
          overflow: "hidden",
        },
        // 11px, bukan 10: label tab di rancangan baru sejajar berat dengan teks
        // sekunder di layarnya, dan 10px membuatnya terbaca seperti catatan kaki
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="kehadiran"
        options={{
          title: "Kehadiran",
          tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pengajuan"
        options={{
          title: "Pengajuan",
          tabBarBadge: pendingRequests || undefined,
          tabBarBadgeStyle: { backgroundColor: theme.danger?.val, fontSize: 10 },
          tabBarIcon: ({ color }) => <Feather name="bookmark" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Beranda",
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tim"
        options={{
          title: "Tim",
          tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pengaturan"
        options={{
          title: "Pengaturan",
          tabBarIcon: ({ color }) => <Feather name="settings" size={22} color={color} />,
        }}
      />
      {/* Pushed screens. `href: null` keeps them inside this navigator — so the
          tab bar stays put and back returns to the tab that opened them — without
          giving any of them a button of its own. */}
      <Tabs.Screen name="absen" options={{ href: null }} />
      <Tabs.Screen name="berkas" options={{ href: null }} />
      <Tabs.Screen name="profil" options={{ href: null }} />
      <Tabs.Screen name="tentang" options={{ href: null }} />
    </Tabs>
      {/* above the tab bar, outside <Tabs> so it survives a tab switch */}
      <Toast />
    </YStack>
  );
}
