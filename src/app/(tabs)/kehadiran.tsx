import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sheet, Text, XStack, YStack, useTheme } from "tamagui";
import { type AttendanceMonth, get } from "@/api";
import { AttendanceDetailSheet } from "@/attendance-detail";
import { bulanLabel, bulanPendek, bulanTerakhir, hariPendek, todayWib } from "@/format";
import {
  AttBadge,
  Empty,
  ErrorNote,
  Mono,
  PageIntro,
  StickyHeader,
  Screen,
  Skeleton,
  useAndroidBack,
  useStickyHeader,
} from "@/ui";

const currentMonth = () => todayWib().slice(0, 7);

/** "Kehadiran Saya" (PRD-Mobile §6.2): own stats and daily log, per month. */
export default function Kehadiran() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isFocused = useIsFocused();
  const [month, setMonth] = useState(currentMonth);
  const [monthPicker, setMonthPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const months = useMemo(() => bulanTerakhir(12), []);
  const monthIndex = months.indexOf(month);

  useFocusEffect(
    useCallback(
      () => () => {
        setMonthPicker(false);
        setDay(null);
      },
      [],
    ),
  );

  const q = useQuery({
    queryKey: ["attendance", month],
    queryFn: ({ signal }) =>
      get<AttendanceMonth>(`/api/me/attendance?month=${month}`, { signal }),
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

  const moveMonth = (direction: -1 | 1) => {
    const next = months[monthIndex + direction];
    if (next) setMonth(next);
  };

  const days = q.data?.days ?? [];
  const stats = q.data?.stats;
  const recorded = (stats?.hadir ?? 0) + (stats?.telat ?? 0);

  // strip buram di bawah status bar + judul kecil, muncul saat digulirkan
  const bar = useStickyHeader();

  return (
    <Screen>
      <FlatList
        onScroll={bar.onScroll}
        scrollEventThrottle={bar.scrollEventThrottle}
        data={q.isPending || q.isError ? [] : days}
        keyExtractor={(item) => item.date}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: insets.top + 18,
          paddingBottom: 28,
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <YStack gap={14} paddingBottom={11}>
            <PageIntro
              title="Kehadiran saya"
              subtitle="Ringkasan dan catatan aktivitas kerja"
            />

            <XStack gap={8} alignItems="stretch">
              <YStack
                width="40%"
                minHeight={127}
                borderRadius={26}
                padding={13}
                justifyContent="space-between"
                overflow="hidden"
                backgroundColor="$accentFill"
              >
                <YStack
                  position="absolute"
                  width={92}
                  height={92}
                  borderRadius={46}
                  backgroundColor="rgba(255,255,255,.10)"
                  right={-34}
                  top={-31}
                  pointerEvents="none"
                />
                <YStack
                  position="absolute"
                  width={58}
                  height={58}
                  borderRadius={29}
                  backgroundColor="rgba(255,255,255,.07)"
                  left={-24}
                  bottom={-20}
                  pointerEvents="none"
                />
                <XStack alignItems="center" justifyContent="space-between">
                  <Text fontSize={10} fontWeight="600" color="$accentFg" opacity={0.78}>
                    Ringkasan
                  </Text>
                  <YStack
                    width={30}
                    height={30}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor="rgba(255,255,255,.15)"
                  >
                    <Feather name="calendar" size={15} color="#fff" />
                  </YStack>
                </XStack>
                <YStack gap={1}>
                  <XStack alignItems="baseline" gap={5}>
                    <Mono fontSize={34} lineHeight={38} fontWeight="700" color="$accentFg">
                      {recorded}
                    </Mono>
                    <Text fontSize={11.5} fontWeight="600" color="$accentFg" opacity={0.78}>
                      hari
                    </Text>
                  </XStack>
                  <Text fontSize={9.5} lineHeight={13} color="$accentFg" opacity={0.72}>
                    {bulanLabel(month)}
                  </Text>
                </YStack>
              </YStack>

              <YStack flex={1} gap={7}>
                <XStack flex={1} gap={7}>
                  <Stat label="Hadir" value={stats?.hadir ?? 0} color="$success" />
                  <Stat label="Terlambat" value={stats?.telat ?? 0} color="$warning" />
                </XStack>
                <XStack flex={1} gap={7}>
                  <Stat label="Cuti / izin" value={stats?.cuti ?? 0} color="$info" />
                  <Stat
                    label="Tanpa ket."
                    value={stats?.tanpaKeterangan ?? 0}
                    color="$danger"
                  />
                </XStack>
              </YStack>
            </XStack>

            <YStack gap={6}>
              <Text fontSize={12} fontWeight="600" color="$fgMuted" paddingLeft={2}>
                Periode
              </Text>
              <XStack
                height={52}
                alignItems="center"
                backgroundColor="$surface"
                borderRadius={18}
                borderWidth={1}
                borderColor="$line"
                paddingHorizontal={6}
              >
                <MonthArrow
                  icon="chevron-left"
                  disabled={monthIndex >= months.length - 1}
                  onPress={() => moveMonth(1)}
                  label="Bulan sebelumnya"
                />
                <XStack
                  flex={1}
                  height={44}
                  borderRadius={16}
                  alignItems="center"
                  justifyContent="center"
                  gap={9}
                  backgroundColor="$accentSubtle"
                  onPress={() => setMonthPicker(true)}
                  pressStyle={{ opacity: 0.72, scale: 0.985 }}
                  accessibilityRole="button"
                  aria-label={`Pilih bulan, saat ini ${bulanLabel(month)}`}
                >
                  <Feather name="calendar" size={17} color={theme.accent?.val} />
                  <Text fontSize={14} fontWeight="700" color="$accent">
                    {bulanLabel(month)}
                  </Text>
                  <Feather name="chevron-down" size={15} color={theme.accent?.val} />
                </XStack>
                <MonthArrow
                  icon="chevron-right"
                  disabled={monthIndex <= 0}
                  onPress={() => moveMonth(-1)}
                  label="Bulan berikutnya"
                />
              </XStack>
            </YStack>

            <XStack alignItems="center" justifyContent="space-between" marginTop={3}>
              <Text fontSize={16.5} fontWeight="700" color="$fg">
                Catatan harian
              </Text>
              <Text fontSize={12} fontWeight="500" color="$fgSubtle">
                {days.length} hari
              </Text>
            </XStack>
          </YStack>
        }
        ListEmptyComponent={
          q.isPending ? (
            <AttendanceSkeleton />
          ) : q.isError ? (
            <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
          ) : (
            <Empty text={`Belum ada catatan kehadiran di ${bulanLabel(month)}.`} />
          )
        }
        renderItem={({ item, index }) => {
          const last = index === days.length - 1;
          return (
            <XStack
              minHeight={82}
              alignItems="center"
              gap={12}
              paddingHorizontal={14}
              paddingVertical={12}
              backgroundColor="$surface"
              borderWidth={1}
              borderBottomWidth={last ? 1 : 0}
              borderColor="$line"
              borderTopLeftRadius={index === 0 ? 24 : 0}
              borderTopRightRadius={index === 0 ? 24 : 0}
              borderBottomLeftRadius={last ? 24 : 0}
              borderBottomRightRadius={last ? 24 : 0}
              onPress={() => setDay(item.date)}
              pressStyle={{ backgroundColor: "$surface2" }}
              accessibilityRole="button"
              aria-label={`${item.date}, ${item.in} sampai ${item.out}, ${item.status}. Buka detail`}
            >
              <YStack
                width={48}
                height={48}
                borderRadius={16}
                backgroundColor="$inset"
                alignItems="center"
                justifyContent="center"
              >
                <Text fontSize={9.5} lineHeight={12} fontWeight="700" color="$fgMuted">
                  {bulanPendek(item.date)}
                </Text>
                <Mono fontSize={17} lineHeight={20} fontWeight="700">
                  {hariPendek(item.date)}
                </Mono>
              </YStack>
              <YStack flex={1} gap={3}>
                <Mono fontSize={14} lineHeight={19} fontWeight="600">
                  {item.in || "—"} – {item.out || "—"}
                </Mono>
                <Text fontSize={11.5} lineHeight={16} color="$fgSubtle">
                  {item.note || "Tidak ada catatan"}
                </Text>
              </YStack>
              <YStack alignItems="flex-end" gap={6} maxWidth="42%">
                <AttBadge status={item.status} />
                <Feather name="chevron-right" size={15} color={theme.fgSubtle?.val} />
              </YStack>
            </XStack>
          );
        }}
      />

      <MonthPickerSheet
        months={months}
        selected={month}
        open={monthPicker}
        onClose={() => setMonthPicker(false)}
        onSelect={(next) => {
          setMonth(next);
          setMonthPicker(false);
        }}
      />
      <AttendanceDetailSheet date={day} open={day !== null} onClose={() => setDay(null)} />
      <StickyHeader shown={bar.shown} title="Kehadiran saya" />
    </Screen>
  );
}

/**
 * Satu angka ringkasan bulan ini.
 *
 * `flex={1}` rata untuk keempatnya. Dulu tiap kartu membawa `weight` sendiri
 * (1,08 dan 0,92) supaya "Terlambat" dan "Tanpa ket." dapat ruang lebih — tapi
 * yang dihasilkan adalah kisi 2×2 dengan empat lebar berbeda, dan kolom yang
 * tidak lurus lebih mengganggu daripada label yang mepet. Dengan lebar yang sama
 * pun labelnya masih muat: yang terpanjang ("Terlambat") ~55px pada 10,5px,
 * sedangkan ruang teksnya ~87px di layar 411dp.
 *
 * `numberOfLines={1}` menjaganya tetap begitu: label yang membungkus akan
 * menaikkan tinggi satu kartu saja dan membengkokkan barisnya.
 */
function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <YStack
      flex={1}
      minWidth={0}
      minHeight={64}
      justifyContent="space-between"
      backgroundColor="$surface"
      borderRadius={18}
      borderWidth={1}
      borderColor="$line"
      paddingHorizontal={12}
      paddingVertical={10}
    >
      <Mono fontSize={20} lineHeight={24} fontWeight="700" color={color}>
        {value}
      </Mono>
      <Text
        fontSize={10.5}
        lineHeight={14}
        fontWeight="500"
        color="$fgMuted"
        numberOfLines={1}
      >
        {label}
      </Text>
    </YStack>
  );
}

function MonthArrow({
  icon,
  disabled,
  onPress,
  label,
}: {
  icon: "chevron-left" | "chevron-right";
  disabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <YStack
      width={44}
      height={44}
      borderRadius={16}
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.28 : 1}
      onPress={disabled ? undefined : onPress}
      pressStyle={disabled ? undefined : { backgroundColor: "$inset", scale: 0.96 }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      aria-label={label}
    >
      <Feather name={icon} size={20} color={theme.fgMuted?.val} />
    </YStack>
  );
}

function MonthPickerSheet({
  months,
  selected,
  open,
  onClose,
  onSelect,
}: {
  months: string[];
  selected: string;
  open: boolean;
  onClose: () => void;
  onSelect: (month: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  useAndroidBack(open, onClose);

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => !next && onClose()}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      transition="medium"
    >
      <Sheet.Overlay backgroundColor="rgba(20,22,27,.42)" />
      <Sheet.Handle />
      <Sheet.Frame
        backgroundColor="$surface"
        borderTopLeftRadius={28}
        borderTopRightRadius={28}
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={insets.bottom + 18}
        gap={16}
      >
        <XStack alignItems="center" justifyContent="space-between">
          <YStack gap={3}>
            <Text fontSize={20} lineHeight={25} fontWeight="700" color="$fg">
              Pilih periode
            </Text>
            <Text fontSize={12} color="$fgMuted">
              Riwayat 12 bulan terakhir
            </Text>
          </YStack>
          <YStack
            width={40}
            height={40}
            borderRadius={16}
            backgroundColor="$inset"
            alignItems="center"
            justifyContent="center"
            onPress={onClose}
            pressStyle={{ opacity: 0.65, scale: 0.96 }}
            accessibilityRole="button"
            aria-label="Tutup pemilih bulan"
          >
            <Feather name="x" size={18} color={theme.fgMuted?.val} />
          </YStack>
        </XStack>

        <XStack flexWrap="wrap" gap={8}>
          {months.map((item) => {
            const active = item === selected;
            return (
              <YStack
                key={item}
                width="31%"
                minHeight={58}
                borderRadius={18}
                paddingHorizontal={8}
                alignItems="center"
                justifyContent="center"
                backgroundColor={active ? "$accentFill" : "$surface2"}
                borderWidth={active ? 0 : 1}
                borderColor="$line"
                onPress={() => onSelect(item)}
                pressStyle={{ opacity: 0.72, scale: 0.97 }}
                accessibilityRole="button"
                aria-selected={active}
              >
                <Text
                  fontSize={12}
                  lineHeight={17}
                  fontWeight="600"
                  textAlign="center"
                  color={active ? "$accentFg" : "$fgMuted"}
                >
                  {bulanLabel(item)}
                </Text>
              </YStack>
            );
          })}
        </XStack>
      </Sheet.Frame>
    </Sheet>
  );
}

function AttendanceSkeleton() {
  return (
    <YStack borderRadius={24} overflow="hidden" borderWidth={1} borderColor="$line">
      {[0, 1, 2, 3, 4].map((item) => (
        <XStack
          key={item}
          minHeight={82}
          alignItems="center"
          gap={12}
          padding={14}
          backgroundColor="$surface"
          borderBottomWidth={item === 4 ? 0 : 1}
          borderBottomColor="$line"
        >
          <Skeleton width={48} height={48} radius={16} />
          <YStack flex={1} gap={8}>
            <Skeleton width="46%" height={12} />
            <Skeleton width="72%" height={9} />
          </YStack>
          <Skeleton width={62} height={26} radius={13} />
        </XStack>
      ))}
    </YStack>
  );
}
