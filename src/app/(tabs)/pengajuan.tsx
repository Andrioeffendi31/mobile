import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, XStack, YStack, useTheme } from "tamagui";
import { type RequestItem, type Requests, get } from "@/api";
import { LeaveSheet, OvertimeSheet } from "@/request-sheets";
import {
  Btn,
  Empty,
  ErrorNote,
  Mono,
  PageIntro,
  StickyHeader,
  ReqBadge,
  Screen,
  Segmented,
  Skeleton,
  useStickyHeader,
} from "@/ui";

type Tab = "cuti" | "lembur";

/** "Pengajuan Saya" (PRD-Mobile §6.3). */
export default function Pengajuan() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ open?: string }>();
  const [tab, setTab] = useState<Tab>("cuti");
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [viewing, setViewing] = useState<RequestItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (params.open === "cuti" || params.open === "lembur") setTab(params.open);
  }, [params.open]);

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

  const q = useQuery({
    queryKey: ["requests"],
    queryFn: ({ signal }) => get<Requests>("/api/me/requests", { signal }),
    enabled: isFocused,
  });
  const items = useMemo(
    () => (tab === "cuti" ? q.data?.cuti : q.data?.lembur) ?? [],
    [q.data, tab],
  );

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const openNew = () => {
    setViewing(null);
    setSheet(tab);
  };

  // strip buram di bawah status bar + judul kecil, muncul saat digulirkan
  const bar = useStickyHeader();

  return (
    <Screen>
      <FlatList
        onScroll={bar.onScroll}
        scrollEventThrottle={bar.scrollEventThrottle}
        data={q.isPending || q.isError ? [] : items}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: insets.top + 18,
          paddingBottom: 28,
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={7}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <YStack gap={14} paddingBottom={11}>
            <PageIntro
              title="Pengajuan saya"
              subtitle="Kelola cuti dan lembur dalam satu tempat"
            />

            <Segmented
              value={tab}
              onChange={setTab}
              marginBottom={0}
              borderRadius={17}
              options={[
                { value: "cuti", label: "Cuti", icon: "calendar" },
                { value: "lembur", label: "Lembur", icon: "clock" },
              ]}
            />

            {tab === "cuti" ? (
              <LeaveBalance balance={q.data?.balance} />
            ) : (
              <OvertimeSummary />
            )}

            <Btn
              height={52}
              borderRadius={18}
              onPress={openNew}
              icon={<Feather name="plus" size={18} color={theme.accentFg?.val} />}
            >
              {tab === "cuti" ? "Ajukan cuti" : "Ajukan lembur"}
            </Btn>

            <XStack alignItems="center" justifyContent="space-between" marginTop={2}>
              <Text fontSize={16.5} lineHeight={21} fontWeight="700" color="$fg">
                Riwayat pengajuan
              </Text>
              <Text fontSize={12} fontWeight="500" color="$fgSubtle">
                {items.length} pengajuan
              </Text>
            </XStack>
          </YStack>
        }
        ListEmptyComponent={
          q.isPending ? (
            <HistorySkeleton />
          ) : q.isError ? (
            <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
          ) : (
            <Empty text={`Belum ada pengajuan ${tab}.`} />
          )
        }
        renderItem={({ item, index }) => (
          <HistoryRow
            item={item}
            first={index === 0}
            last={index === items.length - 1}
            onOpen={() => {
              setViewing(item);
              setSheet(item.kind);
            }}
          />
        )}
      />

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
      <StickyHeader shown={bar.shown} title="Pengajuan saya" />
    </Screen>
  );
}

function LeaveBalance({ balance }: { balance?: Requests["balance"] }) {
  const theme = useTheme();
  const quota = balance?.quota ?? 0;
  const remaining = balance?.remaining ?? 0;
  const used = balance?.used ?? 0;
  const visibleSlots = Math.min(Math.max(quota, 0), 18);

  return (
    <XStack minHeight={156} gap={9}>
      <YStack
        width="42%"
        borderRadius={28}
        padding={15}
        justifyContent="space-between"
        overflow="hidden"
        backgroundColor="$accentFill"
      >
        <YStack
          position="absolute"
          width={96}
          height={96}
          borderRadius={48}
          right={-30}
          top={-30}
          backgroundColor="rgba(255,255,255,.10)"
          pointerEvents="none"
        />
        <XStack alignItems="center" justifyContent="space-between">
          <Text fontSize={10.5} fontWeight="600" color="$accentFg" opacity={0.78}>
            Sisa cuti
          </Text>
          <YStack
            width={32}
            height={32}
            borderRadius={13}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(255,255,255,.15)"
          >
            <Feather name="calendar" size={15} color="#fff" />
          </YStack>
        </XStack>
        <YStack gap={1}>
          <XStack alignItems="baseline" gap={5}>
            <Mono fontSize={38} lineHeight={43} fontWeight="700" color="$accentFg">
              {balance ? remaining : "—"}
            </Mono>
            <Text fontSize={11.5} fontWeight="600" color="$accentFg" opacity={0.78}>
              hari
            </Text>
          </XStack>
          <Text fontSize={9.5} lineHeight={13} color="$accentFg" opacity={0.7}>
            dari {balance ? quota : "—"} hari kuota
          </Text>
        </YStack>
      </YStack>

      <YStack
        flex={1}
        borderRadius={25}
        borderWidth={1}
        borderColor="$line"
        backgroundColor="$surface"
        padding={14}
        justifyContent="space-between"
        gap={10}
      >
        <YStack gap={2}>
          <Text fontSize={11.5} fontWeight="600" color="$fg">
            Kuota tahunan
          </Text>
          <Text fontSize={9.5} lineHeight={13} color="$fgSubtle">
            Setiap kotak mewakili 1 hari
          </Text>
        </YStack>

        <XStack flexWrap="wrap" gap={5} accessibilityLabel={`${remaining} dari ${quota} hari tersisa`}>
          {visibleSlots > 0 ? (
            Array.from({ length: visibleSlots }, (_, index) => {
              const available = index >= used;
              return (
                <YStack
                  key={index}
                  width={18}
                  height={18}
                  borderRadius={6}
                  backgroundColor={available ? "$accentFill" : "$inset"}
                  borderWidth={available ? 0 : 1}
                  borderColor="$line"
                />
              );
            })
          ) : (
            <Text fontSize={12} color="$fgSubtle">
              Kuota belum tersedia
            </Text>
          )}
        </XStack>

        <XStack alignItems="center" justifyContent="space-between" gap={8}>
          <XStack alignItems="center" gap={5}>
            <YStack width={8} height={8} borderRadius={3} backgroundColor="$inset" />
            <Text fontSize={9.5} color="$fgSubtle">
              Terpakai {used}
            </Text>
          </XStack>
          <XStack alignItems="center" gap={5}>
            <Feather name="refresh-cw" size={11} color={theme.fgSubtle?.val} />
            <Text fontSize={9.5} color="$fgSubtle">
              Reset tahunan
            </Text>
          </XStack>
        </XStack>
      </YStack>
    </XStack>
  );
}

function OvertimeSummary() {
  const theme = useTheme();
  return (
    <YStack
      minHeight={152}
      borderRadius={28}
      borderWidth={1}
      borderColor="$line"
      backgroundColor="$surface"
      padding={17}
      gap={13}
      overflow="hidden"
    >
      <YStack
        position="absolute"
        width={126}
        height={126}
        borderRadius={63}
        right={-38}
        top={-48}
        backgroundColor="$warningSubtle"
        opacity={0.75}
        pointerEvents="none"
      />
      <XStack alignItems="center" justifyContent="space-between" gap={12}>
        <YStack flex={1} gap={3}>
          <Text fontSize={15} lineHeight={20} fontWeight="700" color="$fg">
            Persetujuan lembur
          </Text>
          <Text fontSize={10.5} lineHeight={15} color="$fgMuted">
            Ajukan dan tunggu persetujuan HR sebelum mulai bekerja.
          </Text>
        </YStack>
        <YStack
          width={48}
          height={48}
          borderRadius={18}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$warningSubtle"
        >
          <Feather name="clock" size={22} color={theme.warning?.val} />
        </YStack>
      </XStack>
      <XStack alignItems="center" gap={6}>
        <FlowStep number="1" label="Ajukan" active />
        <YStack flex={1} height={1} backgroundColor="$lineStrong" />
        <FlowStep number="2" label="Review HR" />
        <YStack flex={1} height={1} backgroundColor="$lineStrong" />
        <FlowStep number="3" label="Mulai kerja" />
      </XStack>
    </YStack>
  );
}

function FlowStep({ number, label, active = false }: { number: string; label: string; active?: boolean }) {
  return (
    <YStack alignItems="center" gap={5}>
      <YStack
        width={27}
        height={27}
        borderRadius={10}
        alignItems="center"
        justifyContent="center"
        backgroundColor={active ? "$accentFill" : "$inset"}
      >
        <Mono fontSize={10.5} fontWeight="700" color={active ? "$accentFg" : "$fgMuted"}>
          {number}
        </Mono>
      </YStack>
      <Text fontSize={8.5} lineHeight={11} fontWeight="500" color="$fgSubtle">
        {label}
      </Text>
    </YStack>
  );
}

function HistoryRow({
  item,
  first,
  last,
  onOpen,
}: {
  item: RequestItem;
  first: boolean;
  last: boolean;
  onOpen: () => void;
}) {
  const theme = useTheme();
  return (
    <XStack
      minHeight={86}
      alignItems="center"
      gap={12}
      paddingHorizontal={14}
      paddingVertical={12}
      backgroundColor="$surface"
      borderWidth={1}
      borderBottomWidth={last ? 1 : 0}
      borderColor="$line"
      borderTopLeftRadius={first ? 24 : 0}
      borderTopRightRadius={first ? 24 : 0}
      borderBottomLeftRadius={last ? 24 : 0}
      borderBottomRightRadius={last ? 24 : 0}
      pressStyle={{ backgroundColor: "$surface2" }}
      onPress={onOpen}
      accessibilityRole="button"
      aria-label={`${item.title}, ${item.detail}, ${item.status}. Buka detail`}
    >
      <YStack
        width={44}
        height={44}
        borderRadius={16}
        alignItems="center"
        justifyContent="center"
        backgroundColor={item.kind === "cuti" ? "$accentSubtle" : "$warningSubtle"}
      >
        <Feather
          name={item.kind === "cuti" ? "calendar" : "clock"}
          size={19}
          color={item.kind === "cuti" ? theme.accent?.val : theme.warning?.val}
        />
      </YStack>
      <YStack flex={1} gap={3}>
        <Text fontSize={13.5} lineHeight={18} fontWeight="600" color="$fg">
          {item.title}
        </Text>
        <Mono fontSize={11.5} lineHeight={16} color="$fgMuted">
          {item.detail}
        </Mono>
        {item.note ? (
          <Text
            fontSize={10.5}
            lineHeight={15}
            color={item.status === "revisi" ? "$accent" : "$fgSubtle"}
          >
            {item.status === "revisi" ? `HR: ${item.note}` : item.note}
          </Text>
        ) : null}
      </YStack>
      <YStack alignItems="flex-end" gap={7} maxWidth="38%">
        <ReqBadge status={item.status} />
        <XStack alignItems="center" gap={6}>
          {item.attachment ? (
            <Feather name="paperclip" size={12} color={theme.fgSubtle?.val} />
          ) : null}
          <Feather name="chevron-right" size={15} color={theme.fgSubtle?.val} />
        </XStack>
      </YStack>
    </XStack>
  );
}

function HistorySkeleton() {
  return (
    <YStack borderRadius={24} overflow="hidden" borderWidth={1} borderColor="$line">
      {[0, 1, 2].map((item) => (
        <XStack
          key={item}
          minHeight={86}
          alignItems="center"
          gap={12}
          padding={14}
          backgroundColor="$surface"
          borderBottomWidth={item === 2 ? 0 : 1}
          borderBottomColor="$line"
        >
          <Skeleton width={44} height={44} radius={16} />
          <YStack flex={1} gap={8}>
            <Skeleton width="62%" height={12} />
            <Skeleton width="78%" height={9} />
          </YStack>
          <Skeleton width={62} height={25} radius={13} />
        </XStack>
      ))}
    </YStack>
  );
}
