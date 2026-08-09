import { useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "@tamagui/linear-gradient";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type Bootstrap, get } from "@/api";
import { Pengumuman } from "@/announcements";
import {
  canPingInBackground,
  startBackgroundPing,
  stopBackgroundPing,
} from "@/background-ping";
import { durasiJam, jamWib, sapaan, tanggalPanjang } from "@/format";
import { HEADER_GRADIENT, tint } from "@/theme";
import { toast } from "@/toast";
import {
  Avatar,
  Btn,
  Card,
  ErrorNote,
  Mono,
  Screen,
  SectionLabel,
  Skeleton,
  SkeletonRows,
} from "@/ui";

export default function Beranda() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [clock, setClock] = useState(jamWib(true));

  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Bootstrap>("/api/me") });

  // the mockup's live clock; one interval, cleaned up with the screen
  useEffect(() => {
    const t = setInterval(() => setClock(jamWib(true)), 1000);
    return () => clearInterval(t);
  }, []);

  const data = me.data;
  const clockedIn = Boolean(data?.today.clockIn && !data.today.clockOut);

  /**
   * Start/stop the 3-hourly location trail with the working day (PRD-Mobile §6.1
   * follow-on). The task itself lives in src/background-ping.ts and keeps running
   * with the app closed; this effect only mirrors the clock-in state onto it. The
   * trail's first point is the punch itself — /api/me/clock already writes the
   * `masuk` event with coordinates — so the task only has to cover the hours
   * after. A refused background permission is reported once, not nagged: clock-in
   * still works without it.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clockedIn) {
        await stopBackgroundPing();
        return;
      }
      if (await canPingInBackground()) return;
      const ok = await startBackgroundPing();
      if (!ok && !cancelled) {
        toast("Izin lokasi latar belakang ditolak · jejak lokasi tidak tercatat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clockedIn]);

  if (me.isPending) return <BerandaSkeleton />;
  if (me.isError || !data) {
    return (
      <Screen paddingHorizontal={18} paddingTop={insets.top + 40}>
        <ErrorNote message={(me.error as Error)?.message ?? "Gagal memuat"} onRetry={me.refetch} />
      </Screen>
    );
  }

  // No role wall here any more. An HR Admin is an employee too: they have a
  // division, a shift and a geofence like everyone else, and telling them to go
  // and use the web console left them with no way to record their own attendance.
  // Everything this app touches is /api/me/* — session-scoped by withMe — so a
  // higher role grants nothing extra here, it just works.

  const quick = [
    { label: "Ajukan cuti", icon: "calendar", tint: "$accent", bg: "$accentSubtle", to: "/pengajuan?open=cuti" },
    { label: "Ajukan lembur", icon: "clock", tint: "$warning", bg: "$warningSubtle", to: "/pengajuan?open=lembur" },
    { label: "Riwayat absen", icon: "check-circle", tint: "$success", bg: "$successSubtle", to: "/kehadiran" },
    { label: "Berkas saya", icon: "folder", tint: "$info", bg: "$infoSubtle", to: "/berkas" },
  ] as const;

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={me.isFetching}
            // the feed at the foot of this screen owns its own query, so one pull
            // has to reach both
            onRefresh={() => {
              void me.refetch();
              void qc.invalidateQueries({ queryKey: ["announcements"] });
            }}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        {/* tamagui's wrapper around expo-linear-gradient, so it takes the same
            style props as everything else on this screen */}
        <LinearGradient
          colors={[...HEADER_GRADIENT]}
          start={[0, 0]}
          end={[0.6, 1]}
          paddingTop={insets.top + 10}
          paddingHorizontal={22}
          paddingBottom={58}
        >
          <XStack alignItems="center" justifyContent="space-between" paddingBottom={18}>
            <YStack flex={1}>
              <Text fontSize={13} color="#fff" opacity={0.85}>
                {sapaan()},
              </Text>
              <Text fontSize={20} fontWeight="700" color="#fff" numberOfLines={1}>
                {data.profile.name}
              </Text>
              <Mono fontSize={11.5} color="#fff" opacity={0.8}>
                {data.profile.nik} · {data.profile.division}
              </Mono>
            </YStack>
            {/* the mockup's shortcut into Pengaturan — the avatar is where a
                phone user reaches for their own account */}
            <Avatar
              seed={data.profile.id}
              initials={data.profile.initials}
              photoKey={data.profile.photoKey}
              size={44}
              borderWidth={2}
              borderColor="rgba(255,255,255,.3)"
              onPress={() => router.push("/pengaturan")}
              pressStyle={{ opacity: 0.8 }}
              accessibilityRole="button"
              aria-label="Buka pengaturan"
            />
          </XStack>

          <XStack gap={9}>
            <HeaderStat
              label="Status"
              value={clockedIn ? "Sudah absen" : data.today.clockOut ? "Selesai" : "Belum absen"}
            />
            <HeaderStat label="Sisa cuti" value={`${data.leave.remaining} hari`} numeric />
            <HeaderStat label="Lembur" value={durasiJam(data.overtime.minutes)} numeric />
          </XStack>
        </LinearGradient>

        <YStack paddingHorizontal={18} marginTop={-40} gap={16}>
          <Card padding={19} alignItems="center" elevation={8}>
            <Text fontSize={12} color="$fgSubtle" textAlign="center">
              {tanggalPanjang(data.today.date)} · Shift {data.shift.start}–{data.shift.end}
            </Text>
            <Mono fontSize={38} fontWeight="700" marginVertical={2}>
              {clock}
            </Mono>
            {data.today.clockOut ? (
              <Text fontSize={12.5} color="$fgMuted" marginBottom={15}>
                Absen {data.today.clockIn?.slice(0, 5)} – {data.today.clockOut.slice(0, 5)} ·
                selesai hari ini
              </Text>
            ) : clockedIn ? (
              <Text fontSize={12.5} color="$success" fontWeight="500" marginBottom={15}>
                Absen masuk {data.today.clockIn?.slice(0, 5)} ·{" "}
                {data.today.location ?? "lokasi tidak dicatat"}
              </Text>
            ) : (
              <Text fontSize={12.5} color="$fgMuted" marginBottom={15}>
                Belum absen masuk hari ini
              </Text>
            )}

            {data.today.clockOut ? (
              <Btn width="100%" disabled>
                Absen hari ini selesai
              </Btn>
            ) : (
              <Btn
                width="100%"
                height={48}
                tone={clockedIn ? "danger" : undefined}
                onPress={() => router.push("/absen")}
              >
                {clockedIn ? "Absen keluar" : "Absen masuk sekarang"}
              </Btn>
            )}

            <XStack alignItems="center" justifyContent="center" gap={6} marginTop={11}>
              <Feather name="map-pin" size={12} color="#8b93a1" />
              {/* with several offices there is no single radius to quote; the
                  picker on the punch screen is where the numbers belong */}
              <Text fontSize={11} color="$fgSubtle">
                {data.offices.length === 1
                  ? `${data.offices[0].name} · radius ${data.offices[0].radiusM} m`
                  : data.offices.length
                    ? `${data.offices.length} titik absen tersedia`
                    : "Belum ada titik absen · absen harus ditandai WFH"}
              </Text>
            </XStack>
          </Card>

          <XStack gap={9}>
            {quick.map((q) => (
              <Card
                key={q.label}
                flex={1}
                paddingVertical={12}
                paddingHorizontal={6}
                alignItems="center"
                gap={7}
                pressStyle={{ borderColor: "$accentLine" }}
                onPress={() => router.push(q.to)}
              >
                <YStack
                  width={34}
                  height={34}
                  borderRadius={11}
                  backgroundColor={q.bg}
                  alignItems="center"
                  justifyContent="center"
                >
                  <Feather name={q.icon} size={17} color={tint(q.tint)} />
                </YStack>
                <Text fontSize={10.5} fontWeight="500" color="$fgMuted" textAlign="center">
                  {q.label}
                </Text>
              </Card>
            ))}
          </XStack>

          <YStack gap={10}>
            <XStack alignItems="center" justifyContent="space-between">
              <SectionLabel>Rekan hadir hari ini</SectionLabel>
              <Text
                fontSize={12}
                fontWeight="600"
                color="$accent"
                onPress={() => router.push("/tim")}
              >
                Lihat tim
              </Text>
            </XStack>
            <Card flexDirection="row" alignItems="center" gap={12} paddingHorizontal={14}>
              <XStack>
                {data.team.avatars.map((t, i) => (
                  <Avatar
                    key={t.id}
                    seed={t.id}
                    initials={t.initials}
                    photoKey={t.photoKey}
                    size={28}
                    marginLeft={i ? -8 : 0}
                    borderWidth={2}
                    borderColor="$surface"
                  />
                ))}
              </XStack>
              <Text fontSize={12} color="$fgMuted" flex={1}>
                {data.team.present} dari {data.team.total} rekan sudah absen masuk
              </Text>
            </Card>
          </YStack>

          <Pengumuman />
        </YStack>
      </ScrollView>
    </Screen>
  );
}

/**
 * The Beranda while /api/me is in flight. The gradient header and the card
 * geometry are static, so they are drawn for real and only the values are
 * skeletons — the screen that appears at launch is then the screen that stays,
 * with the numbers filling in rather than the whole layout replacing a spinner.
 *
 * Blocks on the header use a translucent white instead of a theme token: $inset
 * over indigo would be a light-grey patch.
 */
function BerandaSkeleton() {
  const insets = useSafeAreaInsets();
  const onHeader = "rgba(255,255,255,.28)";

  return (
    <Screen>
      <LinearGradient
        colors={[...HEADER_GRADIENT]}
        start={[0, 0]}
        end={[0.6, 1]}
        paddingTop={insets.top + 10}
        paddingHorizontal={22}
        paddingBottom={58}
      >
        <XStack alignItems="center" justifyContent="space-between" paddingBottom={18}>
          <YStack gap={7} flex={1}>
            <Skeleton width="34%" height={10} color={onHeader} />
            <Skeleton width="58%" height={15} color={onHeader} />
            <Skeleton width="46%" height={9} color={onHeader} />
          </YStack>
          <Skeleton width={44} height={44} radius={22} color={onHeader} />
        </XStack>
        <XStack gap={9}>
          {[0, 1, 2].map((i) => (
            <YStack
              key={i}
              flex={1}
              backgroundColor="rgba(255,255,255,.14)"
              borderRadius={12}
              padding={10}
              gap={7}
            >
              <Skeleton width="62%" height={9} color={onHeader} />
              <Skeleton width="80%" height={12} color={onHeader} />
            </YStack>
          ))}
        </XStack>
      </LinearGradient>

      <YStack paddingHorizontal={18} marginTop={-40} gap={16}>
        <Card padding={19} alignItems="center" gap={11} elevation={8}>
          <Skeleton width="66%" height={9} />
          <Skeleton width="44%" height={30} radius={9} />
          <Skeleton width="52%" height={9} />
          <Skeleton height={48} radius={12} />
        </Card>

        <XStack gap={9}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} flex={1} paddingVertical={13} alignItems="center" gap={8}>
              <Skeleton width={34} height={34} radius={11} />
              <Skeleton width="72%" height={8} />
            </Card>
          ))}
        </XStack>

        <SkeletonRows count={1} lead={28} trail={false} />
      </YStack>
    </Screen>
  );
}

function HeaderStat({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <YStack flex={1} backgroundColor="rgba(255,255,255,.14)" borderRadius={12} padding={10}>
      <Text fontSize={11} color="#fff" opacity={0.85}>
        {label}
      </Text>
      {numeric ? (
        <Mono fontSize={14} fontWeight="600" color="#fff" marginTop={1}>
          {value}
        </Mono>
      ) : (
        <Text fontSize={14} fontWeight="600" color="#fff" marginTop={1}>
          {value}
        </Text>
      )}
    </YStack>
  );
}

