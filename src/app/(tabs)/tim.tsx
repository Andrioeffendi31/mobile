import { useCallback, useMemo, useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type Team, get } from "@/api";
import { tanggalPanjang } from "@/format";
import { tint } from "@/theme";
import {
  AttBadge,
  Avatar,
  Card,
  Chip,
  Empty,
  ErrorNote,
  Input,
  Screen,
  SkeletonRows,
  Title,
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

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

  const q = useQuery({ queryKey: ["team"], queryFn: () => get<Team>("/api/me/team") });

  const members = q.data?.members ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        (!needle || m.name.toLowerCase().includes(needle)) &&
        (filter === "all" || group(m.status) === filter),
    );
  }, [members, query, filter]);

  const present = members.filter((m) => group(m.status) === "hadir" || group(m.status) === "telat");

  return (
    <Screen paddingTop={insets.top}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <Title marginBottom={4}>Kehadiran Tim</Title>
        <Text fontSize={12.5} color="$fgMuted" marginBottom={14}>
          {q.data ? tanggalPanjang(q.data.date) : "—"} · {present.length} dari {members.length}{" "}
          rekan sudah absen masuk
        </Text>

        <XStack alignItems="center" marginBottom={12}>
          <YStack position="absolute" left={12} zIndex={1}>
            <Feather name="search" size={15} color={tint("$fgSubtle")} />
          </YStack>
          <Input
            flex={1}
            paddingLeft={34}
            value={query}
            onChangeText={setQuery}
            placeholder="Cari rekan…"
            autoCapitalize="none"
            returnKeyType="search"
          />
        </XStack>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <XStack gap={7} paddingBottom={13}>
            {FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={f.label}
                on={filter === f.value}
                onPress={() => setFilter(f.value)}
              />
            ))}
          </XStack>
        </ScrollView>

        {q.isPending ? (
          <SkeletonRows count={5} />
        ) : q.isError ? (
          <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
        ) : visible.length === 0 ? (
          <Empty text="Tidak ada rekan yang cocok" />
        ) : (
          <YStack gap={8}>
            {visible.map((m) => (
              <Card key={m.id} flexDirection="row" alignItems="center" gap={11} paddingHorizontal={13}>
                <Avatar seed={m.id} initials={m.initials} photoKey={m.photoKey} />
                <YStack flex={1}>
                  <Text fontSize={13.5} fontWeight="500" color="$fg" numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text fontSize={11.5} color="$fgSubtle" numberOfLines={1}>
                    {m.position} · {m.detail}
                  </Text>
                </YStack>
                <AttBadge status={m.status} />
              </Card>
            ))}
          </YStack>
        )}
      </ScrollView>
    </Screen>
  );
}
