import { useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Paragraph, ScrollView, Text, XStack, YStack } from "tamagui";
import { type Announcements, type Documents, get, logout, postForm } from "@/api";
import { usePrefs } from "@/prefs";
import { cat, tint } from "@/theme";
import { available as passkeyAvailable, enrollPasskey } from "@/passkey";
import { unregisterFromPush, usePushStatus } from "@/push";
import { toast } from "@/toast";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Mono,
  Note,
  Screen,
  Segmented,
  Title,
} from "@/ui";

type Tab = "pengumuman" | "berkas";

/** "Info & Berkas" (PRD-Mobile §6.5). */
export default function Info() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>("pengumuman");
  const qc = useQueryClient();

  useEffect(() => {
    if (params.tab === "berkas") setTab("berkas");
  }, [params.tab]);

  // clear the cache too: the next person to sign in on this phone must not see
  // the previous employee's cached leave balance for a frame
  const keluar = async () => {
    await unregisterFromPush();
    await logout();
    qc.clear();
  };

  return (
    <Screen paddingTop={insets.top}>
      <XStack marginHorizontal={18} alignItems="center" justifyContent="space-between">
        <Title>Info &amp; Berkas</Title>
        {/* The mockup has no profile tab, and signing out has to live somewhere
            an employee can find — this is the only screen that is about the
            account rather than about a day's work. */}
        <XStack alignItems="center" gap={14}>
          <ThemeToggle />
          <Text
            fontSize={12.5}
            fontWeight="600"
            color="$danger"
            onPress={keluar}
            accessibilityRole="button"
          >
            Keluar
          </Text>
        </XStack>
      </XStack>
      <YStack paddingHorizontal={18}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "pengumuman", label: "Pengumuman" },
            { value: "berkas", label: "Berkas saya" },
          ]}
        />
      </YStack>
      {tab === "pengumuman" ? <Feed /> : <Berkas />}
    </Screen>
  );
}

function Feed() {
  const q = useQuery({
    queryKey: ["announcements"],
    queryFn: () => get<Announcements>("/api/me/announcements"),
  });

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 11 }}
    >
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
      ) : q.data.items.length === 0 ? (
        <Empty text="Belum ada pengumuman." />
      ) : (
        q.data.items.map((a) => {
          const tone = cat(a.category);
          return (
            <Card
              key={a.id}
              paddingHorizontal={15}
              paddingVertical={14}
              borderColor={a.pinned ? "$accentLine" : "$line"}
              flexDirection="row"
              gap={11}
              alignItems="flex-start"
            >
              <YStack
                width={32}
                height={32}
                borderRadius={10}
                backgroundColor={tone.bg}
                alignItems="center"
                justifyContent="center"
              >
                <Feather name="volume-2" size={15} color={tint(tone.fg)} />
              </YStack>
              <YStack flex={1} gap={2}>
                <XStack alignItems="center" gap={7} flexWrap="wrap">
                  <Text fontSize={14} fontWeight="600" color="$fg">
                    {a.title}
                  </Text>
                  {a.pinned ? (
                    <Badge label="Penting" fg="$warning" bg="$warningSubtle" />
                  ) : null}
                </XStack>
                <Text fontSize={11.5} color="$fgSubtle">
                  {a.author} · {a.date} · {a.category}
                </Text>
                <Paragraph fontSize={12.5} color="$fgMuted" lineHeight={19} marginTop={6}>
                  {a.body}
                </Paragraph>
              </YStack>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

function Berkas() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["documents"],
    queryFn: () => get<Documents>("/api/me/documents"),
  });

  /**
   * The signed URL, then the system browser. The download itself cannot go
   * through Linking directly: the session lives in a header this app holds, not
   * in the browser's cookie jar — so /api/files/…?json=1 authorizes here and
   * hands back a short-lived R2 URL that carries its own signature.
   */
  const open = useMutation({
    mutationFn: async (doc: { id: number; key: string }) => {
      setBusyId(doc.id);
      const { url } = await get<{ url: string }>(`/api/files/${doc.key}?json=1`);
      await Linking.openURL(url);
    },
    onError: (e) => toast((e as Error).message),
    onSettled: () => setBusyId(null),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled) return null;
      const file = picked.assets[0];
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      return postForm<{ id: number }>("/api/me/documents", form);
    },
    onSuccess: async (res) => {
      if (!res) return;
      await qc.invalidateQueries({ queryKey: ["documents"] });
      toast("Berkas terunggah");
    },
    onError: (e) => toast((e as Error).message),
  });

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 9 }}
    >
      <Note text="Berkas pribadi hanya dapat dilihat oleh Anda dan tim HR." />
      <PasskeyCard />
      <PushCard />

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
      ) : q.data.items.length === 0 ? (
        <Empty text="Belum ada berkas." />
      ) : (
        q.data.items.map((d) => (
          <Card key={d.id} flexDirection="row" alignItems="center" gap={11} paddingHorizontal={13}>
            <YStack
              paddingHorizontal={6}
              paddingVertical={4}
              borderRadius={6}
              backgroundColor={d.ext === "PDF" ? "$dangerSubtle" : "$infoSubtle"}
            >
              <Mono fontSize={9} fontWeight="700" color={d.ext === "PDF" ? "$danger" : "$info"}>
                {d.ext}
              </Mono>
            </YStack>
            <YStack flex={1}>
              <Text fontSize={13} fontWeight="500" color="$fg" numberOfLines={1}>
                {d.name}
              </Text>
              <Text fontSize={11.5} color="$fgSubtle">
                {d.size} · {d.mine ? "pribadi" : "dokumen perusahaan"}
              </Text>
            </YStack>
            {/* seeded rows predate object storage and have no key behind them */}
            <Btn
              small
              tone="ghost"
              width={32}
              disabled={!d.key || busyId === d.id}
              onPress={() => open.mutate(d)}
              aria-label={`Unduh ${d.name}`}
            >
              <Feather name="download" size={14} color={tint("$fgMuted")} />
            </Btn>
          </Card>
        ))
      )}

      <Btn
        tone="ghost"
        marginTop={4}
        disabled={upload.isPending}
        onPress={() => upload.mutate()}
      >
        {upload.isPending ? "Mengunggah…" : "Unggah berkas baru"}
      </Btn>
    </ScrollView>
  );
}

/**
 * Terang / Gelap / Sistem (PRD-Mobile §6.7). Three icons rather than a labelled
 * row: it sits in the header next to "Keluar", where there is no room for words.
 */
function ThemeToggle() {
  const { theme, setTheme } = usePrefs();
  const options = [
    { value: "system", icon: "smartphone", label: "Ikuti sistem" },
    { value: "light", icon: "sun", label: "Terang" },
    { value: "dark", icon: "moon", label: "Gelap" },
  ] as const;

  return (
    <XStack backgroundColor="$inset" borderRadius={9} padding={2}>
      {options.map((o) => {
        const on = theme === o.value;
        return (
          <YStack
            key={o.value}
            width={28}
            height={26}
            borderRadius={7}
            alignItems="center"
            justifyContent="center"
            backgroundColor={on ? "$surface" : "transparent"}
            onPress={() => setTheme(o.value)}
            accessibilityRole="button"
            aria-label={o.label}
            aria-selected={on}
          >
            <Feather name={o.icon} size={13} color={tint(on ? "$fg" : "$fgSubtle")} />
          </YStack>
        );
      })}
    </XStack>
  );
}

/**
 * Enrol this device's biometric (PRD-Mobile §7: "daftarkan passkey dari halaman
 * profil"). There is no profile screen in the mockup's five tabs, so it sits with
 * the other account controls — and it disappears entirely on a device or host
 * where a passkey cannot be bound, rather than offering something that fails.
 */
function PasskeyCard() {
  const [done, setDone] = useState(false);
  const daftar = useMutation({
    mutationFn: enrollPasskey,
    onSuccess: () => {
      setDone(true);
      toast("Passkey terdaftar · lain kali cukup biometrik");
    },
    onError: (e) => toast((e as Error).message),
  });

  if (!passkeyAvailable()) return null;

  return (
    <Card flexDirection="row" alignItems="center" gap={11} paddingHorizontal={13}>
      <YStack
        width={32}
        height={32}
        borderRadius={10}
        backgroundColor="$accentSubtle"
        alignItems="center"
        justifyContent="center"
      >
        <Feather name="shield" size={15} color={tint("$accent")} />
      </YStack>
      <YStack flex={1}>
        <Text fontSize={13} fontWeight="500" color="$fg">
          Masuk dengan biometrik
        </Text>
        <Text fontSize={11.5} color="$fgSubtle">
          {done
            ? "Perangkat ini sudah terdaftar."
            : "Daftarkan sekali, lalu tidak perlu kata sandi lagi."}
        </Text>
      </YStack>
      {done ? null : (
        <Btn small tone="ghost" disabled={daftar.isPending} onPress={() => daftar.mutate()}>
          {daftar.isPending ? "Menunggu…" : "Daftarkan"}
        </Btn>
      )}
    </Card>
  );
}

/**
 * Why push is or is not working, in the app rather than only in the Metro log.
 * Registration happens in the tab layout at startup; this reads back the result,
 * because "notifications are silent" is otherwise indistinguishable from
 * "nothing has been approved yet".
 */
function PushCard() {
  const status = usePushStatus((s) => s.reason);
  const ok = status === null;

  return (
    <Card flexDirection="row" alignItems="center" gap={11} paddingHorizontal={13}>
      <YStack
        width={32}
        height={32}
        borderRadius={10}
        backgroundColor={ok ? "$successSubtle" : "$warningSubtle"}
        alignItems="center"
        justifyContent="center"
      >
        <Feather name="bell" size={15} color={tint(ok ? "$success" : "$warning")} />
      </YStack>
      <YStack flex={1}>
        <Text fontSize={13} fontWeight="500" color="$fg">
          Pemberitahuan
        </Text>
        <Text fontSize={11.5} color="$fgSubtle">
          {ok
            ? "Aktif · Anda akan diberi tahu saat pengajuan diputuskan."
            : status}
        </Text>
      </YStack>
    </Card>
  );
}
