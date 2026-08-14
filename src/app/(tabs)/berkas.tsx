import { useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useIsFocused, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Spinner, Text, YStack } from "tamagui";
import { type Documents, get, postForm } from "@/api";
import { tint } from "@/theme";
import { toast } from "@/toast";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Mono,
  Note,
  PageHeader,
  Screen,
  SkeletonRows,
} from "@/ui";

/**
 * "Berkas saya" — a sub-page of Pengaturan rather than a tab of its own.
 * Documents are something an employee opens a few times a year (a contract, a
 * payslip), not daily like absensi, so it sits one tap inside the account screen
 * instead of spending one of five tab slots.
 */
export default function Berkas() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({
    queryKey: ["documents"],
    queryFn: ({ signal }) => get<Documents>("/api/me/documents", { signal }),
    enabled: isFocused,
  });

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };

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
    <Screen>
      <PageHeader
        title="Berkas saya"
        subtitle="Dokumen pribadi dan perusahaan"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/pengaturan"))}
      />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 9 }}
      >
        <Note text="Berkas pribadi hanya dapat dilihat oleh Anda dan tim HR." />

        {q.isPending ? (
          <SkeletonRows count={4} lead={28} />
        ) : q.isError ? (
          <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
        ) : q.data.items.length === 0 ? (
          <Empty text="Belum ada berkas." />
        ) : (
          q.data.items.map((d) => {
            // seeded rows predate object storage and have nothing behind them
            const openable = Boolean(d.key);
            const busy = busyId === d.id;
            return (
              <Card
                key={d.id}
                flexDirection="row"
                alignItems="center"
                gap={11}
                paddingHorizontal={13}
                opacity={openable ? 1 : 0.55}
                pressStyle={openable && !busy ? { backgroundColor: "$surface2" } : undefined}
                onPress={openable && !busy ? () => open.mutate(d) : undefined}
                accessibilityRole={openable ? "button" : undefined}
                accessibilityState={{ disabled: !openable, busy }}
                aria-label={`Unduh ${d.name}, ${d.size}`}
              >
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
                {/**
                 * A hint, not a button. It used to be a 32px-wide <Btn> whose own
                 * horizontal padding left no room for the 14px glyph inside it — an
                 * empty rounded box that gave no clue what it did. The row itself is
                 * the target now, which is also a much bigger one.
                 */}
                {busy ? (
                  <Spinner size="small" color="$fgSubtle" />
                ) : (
                  <Feather
                    name={openable ? "download" : "slash"}
                    size={16}
                    color={tint("$fgSubtle")}
                  />
                )}
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* sticky: the one action on this screen should not need scrolling past a
          long list to reach */}
      <YStack
        paddingHorizontal={18}
        paddingVertical={13}
        backgroundColor="$surface"
        borderTopWidth={1}
        borderTopColor="$line"
      >
        <Btn
          tone="ghost"
          disabled={upload.isPending}
          onPress={() => upload.mutate()}
          icon={<Feather name="upload" size={15} color={tint("$fgMuted")} />}
        >
          {upload.isPending ? "Mengunggah…" : "Unggah berkas baru"}
        </Btn>
      </YStack>
    </Screen>
  );
}
