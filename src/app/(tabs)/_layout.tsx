import { useEffect } from "react";
import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Tabs, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { YStack, useTheme } from "tamagui";
import { type Bootstrap, get } from "@/api";
import { registerForPush } from "@/push";
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
  // launch where the session was restored from the keychain without a login
  useEffect(() => {
    registerForPush().then((r) => {
      if (!r.ok) console.info("[push] tidak aktif:", r.reason);
    });
  }, []);

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
        name="info"
        options={{
          title: "Info",
          tabBarIcon: ({ color }) => <Feather name="volume-2" size={21} color={color} />,
        }}
      />
    </Tabs>
      {/* above the tab bar, outside <Tabs> so it survives a tab switch */}
      <Toast />
    </YStack>
  );
}
