import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, XStack, YStack, useTheme } from "tamagui";
import { type Team, get } from "@/api";
import { tanggalPanjang } from "@/format";
import {
  AttBadge,
  Avatar,
  Card,
  Empty,
  ErrorNote,
  Input,
  Mono,
  Screen,
  Skeleton,
} from "@/ui";

const FILTERS = [
  { value: "all", label: "Semua" },
  { value: "hadir", label: "Hadir" },
  { value: "telat", label: "Terlambat" },
  { value: "izin", label: "Cuti / izin" },
  { value: "belum", label: "Belum absen" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

/** Which filter chip a status belongs under — same grouping as the mockup. */
const group = (status: string): Filter =>
  status === "hadir" || status === "wfh"
    ? "hadir"
    : status === "telat"
      ? "telat"
      : status === "belum_absen" || status === "tanpa_keterangan"
        ? "belum"
        : // "libur" ikut ember izin, bukan "belum": hari libur divisinya bukan
          // sesuatu yang perlu ditindaklanjuti siapa pun
          "izin";

/**
 * "Kehadiran Tim" (PRD-Mobile §6.4). Search and filter run on the phone: the
 * whole company is one short list, so filtering locally beats a request per
 * keystroke.
 */
export default function Tim() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isFocused = useIsFocused();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);

  // same rule as Kehadiran: a search typed last visit would hide half the team
  // from somebody who came back expecting the list
  useFocusEffect(
    useCallback(
      () => () => {
        setQuery("");
        setFilter("all");
      },
      [],
    ),
  );

  const q = useQuery({
    queryKey: ["team"],
    queryFn: ({ signal }) => get<Team>("/api/me/team", { signal }),
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

  const members = q.data?.members ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        (!needle || m.name.toLowerCase().includes(needle)) &&
        (filter === "all" || group(m.status) === filter),
    );
  }, [members, query, filter]);

  const summary = useMemo(
    () =>
      members.reduce(
        (result, member) => {
          const memberGroup = group(member.status);
          if (memberGroup === "hadir" || memberGroup === "telat") result.present += 1;
          if (memberGroup === "belum") result.absent += 1;
          if (memberGroup === "izin") result.excused += 1;
          return result;
        },
        { present: 0, absent: 0, excused: 0 },
      ),
    [members],
  );
  const progress = members.length ? Math.round((summary.present / members.length) * 100) : 0;

  return (
    <Screen>
      <FlatList
        data={q.isPending || q.isError ? [] : visible}
        keyExtractor={(member) => String(member.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: insets.top + 22, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={9}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <YStack gap={16} paddingBottom={12}>
            <YStack gap={5}>
              <Text
                fontSize={30}
                lineHeight={36}
                fontWeight="700"
                letterSpacing={-0.8}
                color="$fg"
              >
                Kehadiran tim
              </Text>
              <Text fontSize={13} lineHeight={19} color="$fgMuted">
                {q.data ? tanggalPanjang(q.data.date) : "Memuat data hari ini"}
              </Text>
            </YStack>

            <Card
              borderRadius={28}
              padding={18}
              gap={17}
              overflow="hidden"
              backgroundColor="$surface"
            >
              <YStack
                position="absolute"
                width={136}
                height={136}
                borderRadius={68}
                backgroundColor="$accentSubtle"
                right={-38}
                top={-52}
                opacity={0.7}
                pointerEvents="none"
              />
              <XStack alignItems="center" justifyContent="space-between" gap={16}>
                <YStack flex={1} gap={4}>
                  <Text fontSize={12.5} fontWeight="500" color="$fgMuted">
                    Sudah absen masuk
                  </Text>
                  <XStack alignItems="baseline" gap={6}>
                    <Mono fontSize={32} lineHeight={38} fontWeight="700" color="$fg">
                      {summary.present}
                    </Mono>
                    <Text fontSize={14} fontWeight="500" color="$fgSubtle">
                      dari {members.length} rekan
                    </Text>
                  </XStack>
                </YStack>
                <YStack
                  width={58}
                  height={58}
                  borderRadius={20}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="$accentSubtle"
                >
                  <Feather name="users" size={25} color={theme.accent?.val} />
                </YStack>
              </XStack>

              <YStack height={8} borderRadius={4} backgroundColor="$inset" overflow="hidden">
                <YStack
                  height="100%"
                  width={`${progress}%`}
                  minWidth={progress ? 8 : 0}
                  borderRadius={4}
                  backgroundColor="$accentFill"
                />
              </YStack>

              <XStack gap={8}>
                <Summary label="Hadir" value={summary.present} tone="$success" />
                <Summary label="Belum" value={summary.absent} tone="$warning" />
                <Summary label="Izin / libur" value={summary.excused} tone="$info" />
              </XStack>
            </Card>

            <YStack gap={11}>
              <XStack
                height={52}
                alignItems="center"
                borderRadius={19}
                backgroundColor="$surface"
                borderWidth={1}
                borderColor="$line"
                paddingHorizontal={15}
                gap={11}
              >
                <Feather name="search" size={19} color={theme.fgSubtle?.val} />
                <Input
                  flex={1}
                  height={48}
                  paddingHorizontal={0}
                  borderWidth={0}
                  backgroundColor="transparent"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Cari nama rekan"
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {query ? (
                  <YStack
                    width={30}
                    height={30}
                    borderRadius={15}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor="$inset"
                    onPress={() => setQuery("")}
                    pressStyle={{ opacity: 0.65, scale: 0.96 }}
                    accessibilityRole="button"
                    aria-label="Hapus pencarian"
                  >
                    <Feather name="x" size={15} color={theme.fgMuted?.val} />
                  </YStack>
                ) : null}
              </XStack>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <XStack gap={8} paddingRight={18}>
                  {FILTERS.map((item) => (
                    <FilterButton
                      key={item.value}
                      label={item.label}
                      selected={filter === item.value}
                      onPress={() => setFilter(item.value)}
                    />
                  ))}
                </XStack>
              </ScrollView>
            </YStack>

            <XStack alignItems="center" justifyContent="space-between" marginTop={4}>
              <Text fontSize={16.5} fontWeight="700" color="$fg">
                Daftar rekan
              </Text>
              <Text fontSize={12} fontWeight="500" color="$fgSubtle">
                {visible.length} orang
              </Text>
            </XStack>
          </YStack>
        }
        ListEmptyComponent={
          q.isPending ? (
            <TeamSkeleton />
          ) : q.isError ? (
            <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
          ) : (
            <Empty text="Tidak ada rekan yang sesuai pencarian atau filter." />
          )
        }
        renderItem={({ item, index }) => (
          <XStack
            minHeight={78}
            alignItems="center"
            gap={12}
            paddingHorizontal={14}
            paddingVertical={12}
            backgroundColor="$surface"
            borderWidth={1}
            borderBottomWidth={index === visible.length - 1 ? 1 : 0}
            borderColor="$line"
            borderTopLeftRadius={index === 0 ? 24 : 0}
            borderTopRightRadius={index === 0 ? 24 : 0}
            borderBottomLeftRadius={index === visible.length - 1 ? 24 : 0}
            borderBottomRightRadius={index === visible.length - 1 ? 24 : 0}
          >
            <Avatar
              seed={item.id}
              initials={item.initials}
              photoKey={isFocused ? item.photoKey : null}
              size={46}
              borderRadius={16}
            />
            <YStack flex={1} gap={3}>
              <Text fontSize={14.5} lineHeight={19} fontWeight="600" color="$fg">
                {item.name}
              </Text>
              <Text fontSize={11.5} lineHeight={16} color="$fgSubtle">
                {[item.position, item.detail].filter(Boolean).join(" · ")}
              </Text>
            </YStack>
            <AttBadge status={item.status} />
          </XStack>
        )}
      />
    </Screen>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <YStack flex={1} backgroundColor="$surface2" borderRadius={16} padding={11} gap={3}>
      <Mono fontSize={17} lineHeight={21} fontWeight="700" color={tone}>
        {value}
      </Mono>
      <Text fontSize={10.5} lineHeight={14} color="$fgMuted">
        {label}
      </Text>
    </YStack>
  );
}

function FilterButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <XStack
      minHeight={38}
      alignItems="center"
      borderRadius={19}
      paddingHorizontal={15}
      backgroundColor={selected ? "$accentFill" : "$surface"}
      borderWidth={selected ? 0 : 1}
      borderColor="$lineStrong"
      onPress={onPress}
      pressStyle={{ opacity: 0.72, scale: 0.98 }}
      accessibilityRole="button"
      aria-selected={selected}
    >
      <Text fontSize={12.5} fontWeight="600" color={selected ? "$accentFg" : "$fgMuted"}>
        {label}
      </Text>
    </XStack>
  );
}

function TeamSkeleton() {
  return (
    <YStack borderRadius={24} overflow="hidden" borderWidth={1} borderColor="$line">
      {[0, 1, 2, 3, 4].map((item) => (
        <XStack
          key={item}
          minHeight={78}
          alignItems="center"
          gap={12}
          padding={14}
          backgroundColor="$surface"
          borderBottomWidth={item === 4 ? 0 : 1}
          borderBottomColor="$line"
        >
          <Skeleton width={46} height={46} radius={16} />
          <YStack flex={1} gap={8}>
            <Skeleton width="62%" height={12} />
            <Skeleton width="82%" height={9} />
          </YStack>
          <Skeleton width={54} height={26} radius={13} />
        </XStack>
      ))}
    </YStack>
  );
}
