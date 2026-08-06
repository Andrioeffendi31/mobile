import { useCallback, useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Progress, ScrollView, Text, XStack, YStack } from "tamagui";
import { Feather } from "@expo/vector-icons";
import { type RequestItem, type Requests, get } from "@/api";
import { tint } from "@/theme";
import { durasiJam, todayWib } from "@/format";
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
  /**
   * The request the form is showing. null with `sheet` set means filing a new one —
   * the same sheet reads a request, edits it, or starts empty, so there is nothing
   * else to track.
   */
  const [viewing, setViewing] = useState<RequestItem | null>(null);

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

  /** same rule as the other tabs: leaving puts this screen back to its opening
   *  state, so a half-filled form is never waiting behind a tab switch */
  useFocusEffect(
    useCallback(
      () => () => {
        setSheet(null);
        setViewing(null);
        setTab("cuti");
      },
      [],
    ),
  );

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
            setViewing(null);
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
                onOpen={() => {
                  setViewing(r);
                  setSheet(r.kind);
                }}
              />
            ))}
          </YStack>
        )}
      </ScrollView>

      <LeaveSheet
        open={sheet === "cuti"}
        request={viewing}
        onClose={() => {
          setSheet(null);
          setViewing(null);
        }}
        delegates={q.data?.delegates ?? []}
        remaining={q.data?.balance?.remaining ?? 0}
      />
      <OvertimeSheet
        open={sheet === "lembur"}
        request={viewing}
        onClose={() => {
          setSheet(null);
          setViewing(null);
        }}
      />
    </Screen>
  );
}

/**
 * A summary that opens the record. Everything actionable moved into the detail
 * sheet: a list where every row carried its own buttons read as a stack of
 * controls rather than as history, and the buttons were the widest thing on each
 * card while the reason for them was three words long.
 */
function HistoryCard({ item, onOpen }: { item: RequestItem; onOpen: () => void }) {
  return (
    <Card
      paddingHorizontal={14}
      pressStyle={{ backgroundColor: "$surface2" }}
      onPress={onOpen}
      accessibilityRole="button"
      aria-label={`${item.title}, ${item.detail}, ${item.status}. Buka detail`}
    >
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <Text fontSize={13.5} fontWeight="600" color="$fg" flexShrink={1}>
          {item.title}
        </Text>
        <ReqBadge status={item.status} />
      </XStack>

      <XStack alignItems="center" gap={8} marginTop={3}>
        <Mono fontSize={12} color="$fgMuted" flex={1}>
          {item.detail}
        </Mono>
        {item.attachment ? (
          <Feather name="paperclip" size={12} color={tint("$fgSubtle")} />
        ) : null}
        <Feather name="chevron-right" size={15} color={tint("$fgSubtle")} />
      </XStack>

      <Text
        fontSize={11.5}
        color={item.status === "revisi" ? "$accent" : "$fgSubtle"}
        marginTop={5}
        numberOfLines={2}
      >
        {item.status === "revisi" && item.note ? `HR: ${item.note}` : item.note}
      </Text>
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
