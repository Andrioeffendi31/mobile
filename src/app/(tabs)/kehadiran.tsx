import { useCallback, useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type AttendanceMonth, get } from "@/api";
import { AttendanceDetailSheet } from "@/attendance-detail";
import { bulanLabel, bulanPendek, bulanTerakhir, hariPendek, todayWib } from "@/format";
import { tint } from "@/theme";
import {
  AttBadge,
  Card,
  Chip,
  Empty,
  ErrorNote,
  Mono,
  Screen,
  SkeletonRows,
  Title,
} from "@/ui";

/** "Kehadiran Saya" (PRD-Mobile §6.2): own stats and daily log, per month. */
export default function Kehadiran() {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(todayWib().slice(0, 7));
  /** the day whose detail sheet is open, by date — the sheet fetches its own */
  const [day, setDay] = useState<string | null>(null);
  const months = bulanTerakhir(12);

  /**
   * Back to this month, and no sheet, whenever the screen loses focus.
   *
   * Tabs stay mounted, so state outlives the visit: pick "Mei 2026", go to the
   * Beranda, come back — and you are still reading May while the header says
   * nothing about it. A tab should look the way it looks when you first open it.
   */
  useFocusEffect(
    useCallback(
      () => () => {
        setMonth(todayWib().slice(0, 7));
        setDay(null);
      },
      [],
    ),
  );

  const q = useQuery({
    queryKey: ["attendance", month],
    queryFn: () => get<AttendanceMonth>(`/api/me/attendance?month=${month}`),
  });

  return (
    <Screen paddingTop={insets.top}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}
      >
        <Title>Kehadiran Saya</Title>

        <XStack gap={9} marginBottom={15}>
          <Stat label="Hadir" value={q.data?.stats.hadir ?? 0} />
          <Stat label="Terlambat" value={q.data?.stats.telat ?? 0} color="$warning" />
          <Stat label="Cuti / izin" value={q.data?.stats.cuti ?? 0} color="$fgMuted" />
          <Stat
            label="Tanpa ket."
            value={q.data?.stats.tanpaKeterangan ?? 0}
            color="$danger"
          />
        </XStack>

        {/* A horizontal chip rail instead of tamagui's <Select>: Select on native
            needs an <Adapt>/<Sheet> pair to become a picker, which is a lot of
            machinery for twelve values that fit on one scrolling line. */}
        <YStack marginBottom={13} gap={6}>
          <Text fontSize={11.5} fontWeight="500" color="$fgMuted">
            Periode
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack gap={7} paddingBottom={4}>
              {months.map((m) => (
                <Chip key={m} label={bulanLabel(m)} on={m === month} onPress={() => setMonth(m)} />
              ))}
            </XStack>
          </ScrollView>
        </YStack>

        {q.isPending ? (
          <SkeletonRows count={5} />
        ) : q.isError ? (
          <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
        ) : q.data.days.length === 0 ? (
          <Empty text={`Belum ada catatan kehadiran di ${bulanLabel(month)}.`} />
        ) : (
          <YStack gap={8}>
            {q.data.days.map((d) => (
              <Card
                key={d.date}
                flexDirection="row"
                alignItems="center"
                gap={12}
                paddingHorizontal={13}
                pressStyle={{ backgroundColor: "$surface2" }}
                onPress={() => setDay(d.date)}
                accessibilityRole="button"
                aria-label={`${d.date}, ${d.in} sampai ${d.out}, ${d.status}. Buka detail`}
              >
                <YStack
                  width={34}
                  height={34}
                  borderRadius={10}
                  backgroundColor="$inset"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Text fontSize={9} fontWeight="600" color="$fgMuted">
                    {bulanPendek(d.date)}
                  </Text>
                  <Mono fontSize={13} fontWeight="700" lineHeight={14}>
                    {hariPendek(d.date)}
                  </Mono>
                </YStack>
                <YStack flex={1}>
                  <Mono fontSize={13} fontWeight="500">
                    {d.in} – {d.out}
                  </Mono>
                  <Text fontSize={11.5} color="$fgSubtle" numberOfLines={1}>
                    {d.note || "—"}
                  </Text>
                </YStack>
                <AttBadge status={d.status} />
                <Feather name="chevron-right" size={15} color={tint("$fgSubtle")} />
              </Card>
            ))}
          </YStack>
        )}
      </ScrollView>

      <AttendanceDetailSheet
        date={day}
        open={day !== null}
        onClose={() => setDay(null)}
      />
    </Screen>
  );
}

function Stat({
  label,
  value,
  color = "$fg",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <Card flex={1} paddingHorizontal={13}>
      <Text fontSize={11} color="$fgMuted">
        {label}
      </Text>
      <Mono fontSize={19} fontWeight="700" color={color} marginTop={2}>
        {value}
      </Mono>
    </Card>
  );
}
