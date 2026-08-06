import { useEffect } from "react";
import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Tabs, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { YStack, useTheme } from "tamagui";
import { type Bootstrap, get } from "@/api";
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
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => get<Bootstrap>("/api/me"),
  });

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
    registerForPush().then((r) => {
      if (!r.ok) console.info("[push] tidak aktif:", r.reason);
    });
  }, [wantsPush]);

  /**
   * Keep the clock-in alarm in step with the shift and today's punches. Driven by
   * the bootstrap because every punch invalidates it, so absen.tsx cancels the
   * rest of today's reminders without knowing this exists.
   */
  const wantsReminder = usePrefs((s) => s.reminder);
  useEffect(() => {
    void syncReminders(data);
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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent?.val,
        tabBarInactiveTintColor: theme.fgSubtle?.val,
        tabBarStyle: {
          backgroundColor: theme.surface?.val,
          borderTopColor: theme.line?.val,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Beranda",
          tabBarIcon: ({ color }) => <Feather name="home" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="kehadiran"
        options={{
          title: "Kehadiran",
          tabBarIcon: ({ color }) => <Feather name="clock" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pengajuan"
        options={{
          title: "Pengajuan",
          tabBarBadge: data?.pendingRequests ? data.pendingRequests : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.danger?.val, fontSize: 10 },
          tabBarIcon: ({ color }) => <Feather name="bookmark" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tim"
        options={{
          title: "Tim",
          tabBarIcon: ({ color }) => <Feather name="users" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pengaturan"
        options={{
          title: "Pengaturan",
          tabBarIcon: ({ color }) => <Feather name="settings" size={21} color={color} />,
        }}
      />
      {/* Pushed screens. `href: null` keeps them inside this navigator — so the
          tab bar stays put and back returns to the tab that opened them — without
          giving any of them a button of its own. */}
      <Tabs.Screen name="absen" options={{ href: null }} />
      <Tabs.Screen name="berkas" options={{ href: null }} />
      <Tabs.Screen name="tentang" options={{ href: null }} />
    </Tabs>
      {/* above the tab bar, outside <Tabs> so it survives a tab switch */}
      <Toast />
    </YStack>
  );
}
