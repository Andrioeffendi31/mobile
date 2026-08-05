import { useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Progress, ScrollView, Text, XStack, YStack } from "tamagui";
import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { type RequestItem, type Requests, get, postJson } from "@/api";
import { tint } from "@/theme";
import { durasiJam, todayWib } from "@/format";
import { toast } from "@/toast";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Mono,
  ReqBadge,
  Screen,
  SectionLabel,
  Segmented,
  SkeletonRows,
  Title,
} from "@/ui";
import { LeaveSheet, OvertimeSheet } from "@/request-sheets";

type Tab = "cuti" | "lembur";

/** "Pengajuan Saya" (PRD-Mobile §6.3). */
export default function Pengajuan() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ open?: string }>();
  const [tab, setTab] = useState<Tab>("cuti");
  const [sheet, setSheet] = useState<Tab | null>(null);
  /** the request being revised, when the sheet was opened from a card */
  const [editing, setEditing] = useState<RequestItem | null>(null);

  /**
   * The Beranda quick actions pick the segment, and stop there.
   *
   * They used to open the form sheet as well, but `open` stays in the route after
   * the sheet is dismissed — so every later visit to this tab reopened it, and a
   * form appeared over a list somebody meant to read. Landing on the right segment
   * with "Ajukan cuti" one tap away is the same shortcut without the ambush.
   */
  useEffect(() => {
    if (params.open === "cuti" || params.open === "lembur") setTab(params.open);
  }, [params.open]);

  const q = useQuery({ queryKey: ["requests"], queryFn: () => get<Requests>("/api/me/requests") });
  const items = tab === "cuti" ? q.data?.cuti : q.data?.lembur;

  return (
    <Screen paddingTop={insets.top}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}
      >
        <Title>Pengajuan Saya</Title>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "cuti", label: "Cuti" },
            { value: "lembur", label: "Lembur" },
          ]}
        />

        {tab === "cuti" ? (
          <Card marginBottom={13} paddingHorizontal={15} paddingVertical={14} gap={9}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <Text fontSize={12.5} color="$fgMuted">
                Saldo cuti tahunan
              </Text>
              <Mono fontSize={12.5} fontWeight="600">
                {q.data?.balance?.remaining ?? "—"} / {q.data?.balance?.quota ?? "—"} hari
              </Mono>
            </XStack>
            <Progress
              value={pct(q.data?.balance)}
              height={7}
              backgroundColor="$inset"
              borderRadius={4}
            >
              <Progress.Indicator backgroundColor="$accent" transition="quick" />
            </Progress>
            <Text fontSize={11.5} color="$fgSubtle">
              Terpakai {q.data?.balance?.used ?? 0} hari · kedaluwarsa 31 Des{" "}
              {new Date().getFullYear()}
            </Text>
          </Card>
        ) : (
          <Card marginBottom={13} paddingHorizontal={15} paddingVertical={14} gap={8}>
            <Text fontSize={11.5} color="$fgMuted">
              Lembur disetujui bulan ini
            </Text>
            <Mono fontSize={18} fontWeight="700">
              {durasiJam(lemburBulanIni(q.data?.lembur ?? []))}
            </Mono>
            <Text fontSize={11.5} color="$fgSubtle">
              Batas maksimum 14 jam per minggu sesuai kebijakan. Jumlah final dihitung
              server saat pengajuan.
            </Text>
          </Card>
        )}

        <Btn
          marginBottom={16}
          onPress={() => {
            setEditing(null);
            setSheet(tab);
          }}
        >
          {tab === "cuti" ? "Ajukan cuti" : "Ajukan lembur"}
        </Btn>

        <SectionLabel marginBottom={10}>Riwayat pengajuan</SectionLabel>

        {q.isPending ? (
          // history cards have no leading tile
          <SkeletonRows count={3} lead={0} />
        ) : q.isError ? (
          <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
        ) : !items?.length ? (
          <Empty text={`Belum ada pengajuan ${tab}.`} />
        ) : (
          <YStack gap={9}>
            {items.map((r) => (
              <HistoryCard
                key={`${r.kind}-${r.id}`}
                item={r}
                onRevise={() => {
                  setEditing(r);
                  setSheet("cuti");
                }}
              />
            ))}
          </YStack>
        )}
      </ScrollView>

      <LeaveSheet
        open={sheet === "cuti"}
        edit={editing}
        onClose={() => {
          setSheet(null);
          setEditing(null);
        }}
        delegates={q.data?.delegates ?? []}
        remaining={q.data?.balance?.remaining ?? 0}
      />
      <OvertimeSheet open={sheet === "lembur"} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function HistoryCard({
  item,
  onRevise,
}: {
  item: RequestItem;
  onRevise: () => void;
}) {
  const qc = useQueryClient();
  const openAttachment = useMutation({
    mutationFn: async (key: string) => {
      const { url } = await get<{ url: string }>(`/api/files/${key}?json=1`);
      await Linking.openURL(url);
    },
    onError: (e) => toast((e as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () =>
      postJson("/api/me/requests", { kind: item.kind, id: item.id }, "PATCH"),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast("Pengajuan dibatalkan");
    },
    onError: (e) => toast((e as Error).message),
  });

  return (
    <Card paddingHorizontal={14}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <Text fontSize={13.5} fontWeight="600" color="$fg" flexShrink={1}>
          {item.title}
        </Text>
        <ReqBadge status={item.status} />
      </XStack>
      <Mono fontSize={12} color="$fgMuted" marginTop={3}>
        {item.detail}
      </Mono>
      <Text fontSize={11.5} color="$fgSubtle" marginTop={5}>
        {item.note}
      </Text>
      {item.attachment ? (
        <XStack
          alignItems="center"
          gap={8}
          marginTop={9}
          paddingHorizontal={11}
          paddingVertical={9}
          borderRadius={10}
          backgroundColor="$inset"
          pressStyle={{ opacity: 0.7 }}
          onPress={() => openAttachment.mutate(item.attachment!.key)}
          accessibilityRole="button"
          aria-label={`Buka lampiran ${item.attachment.name ?? ""}`}
        >
          <Feather name="paperclip" size={13} color={tint("$fgSubtle")} />
          <Text fontSize={11.5} color="$fgMuted" flex={1} numberOfLines={1}>
            {item.attachment.name ?? "Lampiran"}
          </Text>
          <Feather name="download" size={13} color={tint("$fgSubtle")} />
        </XStack>
      ) : null}

      {/**
       * A revision is the employee's turn, so the note HR wrote is the loudest
       * thing on the card and the fix is one tap from it. Cancelling stays
       * available: sometimes the answer to "please revise" is "never mind".
       */}
      {item.status === "revisi" ? (
        <YStack
          marginTop={10}
          padding={11}
          borderRadius={10}
          backgroundColor="$accentSubtle"
          gap={9}
        >
          <Text fontSize={12} color="$accent" lineHeight={17}>
            HR meminta revisi{item.note ? `: ${item.note}` : "."}
          </Text>
          <XStack gap={8}>
            <Btn small flex={1} onPress={onRevise}>
              Perbaiki &amp; kirim ulang
            </Btn>
            <Btn
              small
              tone="ghost"
              color="$danger"
              borderColor="$danger"
              disabled={cancel.isPending}
              onPress={() => cancel.mutate()}
            >
              {cancel.isPending ? "…" : "Batalkan"}
            </Btn>
          </XStack>
        </YStack>
      ) : item.status === "menunggu" ? (
        <Btn
          small
          tone="ghost"
          alignSelf="flex-start"
          marginTop={10}
          color="$danger"
          // ghost's edge is $fgMuted; this one's label is red, so its border is too
          borderColor="$danger"
          disabled={cancel.isPending}
          onPress={() => cancel.mutate()}
        >
          {cancel.isPending ? "Membatalkan…" : "Batalkan"}
        </Btn>
      ) : null}
    </Card>
  );
}

const pct = (b?: { quota: number; remaining: number } | null) =>
  b && b.quota > 0 ? Math.max(0, Math.min(100, Math.round((b.remaining / b.quota) * 100))) : 0;

/** Approved overtime in the current month — the summary card's only number. */
function lemburBulanIni(rows: RequestItem[]) {
  const month = todayWib().slice(0, 7);
  return rows
    .filter((r) => r.status === "disetujui" && r.date?.startsWith(month))
    .reduce((n, r) => n + (r.minutes ?? 0), 0);
}
