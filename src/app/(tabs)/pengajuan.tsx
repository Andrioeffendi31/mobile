import { useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Progress, ScrollView, Text, XStack, YStack } from "tamagui";
import { type RequestItem, type Requests, get, postJson } from "@/api";
import { durasiJam, todayWib } from "@/format";
import { toast } from "@/toast";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Mono,
  ReqBadge,
  Screen,
  SectionLabel,
  Segmented,
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

  // the Beranda quick actions deep-link straight into a form
  useEffect(() => {
    if (params.open === "cuti" || params.open === "lembur") {
      setTab(params.open);
      setSheet(params.open);
    }
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

        <Btn marginBottom={16} onPress={() => setSheet(tab)}>
          {tab === "cuti" ? "Ajukan cuti" : "Ajukan lembur"}
        </Btn>

        <SectionLabel marginBottom={10}>Riwayat pengajuan</SectionLabel>

        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
        ) : !items?.length ? (
          <Empty text={`Belum ada pengajuan ${tab}.`} />
        ) : (
          <YStack gap={9}>
            {items.map((r) => (
              <HistoryCard key={`${r.kind}-${r.id}`} item={r} />
            ))}
          </YStack>
        )}
      </ScrollView>

      <LeaveSheet
        open={sheet === "cuti"}
        onClose={() => setSheet(null)}
        delegates={q.data?.delegates ?? []}
        remaining={q.data?.balance?.remaining ?? 0}
      />
      <OvertimeSheet open={sheet === "lembur"} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function HistoryCard({ item }: { item: RequestItem }) {
  const qc = useQueryClient();
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
      {item.status === "menunggu" ? (
        <Btn
          small
          tone="ghost"
          alignSelf="flex-start"
          marginTop={10}
          color="$danger"
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
