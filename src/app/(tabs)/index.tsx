import { useEffect, useState } from "react";
import { RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, XStack, YStack, useTheme } from "tamagui";
import { type Bootstrap, type Team, get } from "@/api";
import { Pengumuman } from "@/announcements";
import {
  durasiJam,
  jamWib,
  menitAntara,
  menitKerja,
  sapaan,
  tanggalPanjang,
} from "@/format";
import { GRAD } from "@/theme";
import {
  Avatar,
  Btn,
  Card,
  ErrorNote,
  IconTile,
  Mono,
  Ring,
  Screen,
  Skeleton,
  SkeletonRows,
  StatCard,
} from "@/ui";

export default function Beranda() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const isFocused = useIsFocused();
  const [clock, setClock] = useState(jamWib(true));
  const [refreshing, setRefreshing] = useState(false);
  const [secondaryReady, setSecondaryReady] = useState(false);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
    enabled: isFocused,
  });
  const data = me.data;

  // Team/photos are below the first viewport and have a dedicated endpoint.
  // Starting them after Home commits keeps the critical bootstrap small.
  useEffect(() => {
    if (!isFocused || !data) {
      setSecondaryReady(false);
      return;
    }
    const timer = setTimeout(() => setSecondaryReady(true), 650);
    return () => clearTimeout(timer);
  }, [data, isFocused]);

  const teamQuery = useQuery({
    queryKey: ["team"],
    queryFn: ({ signal }) => get<Team>("/api/me/team", { signal }),
    enabled: isFocused && secondaryReady,
  });

  // the mockup's live clock; one interval, cleaned up with the screen
  useEffect(() => {
    // Do not repaint the entire skeleton once per second while the network is
    // still pending. The live value only becomes visible after bootstrap exists.
    if (!data || !isFocused) return;
    const t = setInterval(() => setClock(jamWib(true)), 1000);
    return () => clearInterval(t);
  }, [data, isFocused]);

  const clockedIn = Boolean(data?.today.clockIn && !data.today.clockOut);

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
    { label: "Cuti", icon: "calendar", grad: GRAD.ungu, to: "/pengajuan?open=cuti" },
    { label: "Lembur", icon: "clock", grad: GRAD.jingga, to: "/pengajuan?open=lembur" },
    { label: "Absen", icon: "check-circle", grad: GRAD.hijau, to: "/kehadiran" },
    { label: "Berkas", icon: "folder", grad: GRAD.biru, to: "/berkas" },
  ] as const;

  const kerja = menitKerja(data.today.clockIn, data.today.clockOut, clock.slice(0, 5));
  const target = menitAntara(data.shift.start, data.shift.end);
  const hadir = teamQuery.data?.members.filter((member) =>
    ["hadir", "wfh", "telat"].includes(member.status),
  );
  const team = {
    total: teamQuery.data?.members.length ?? 0,
    present: hadir?.length ?? 0,
    avatars: (hadir ?? []).slice(0, 5),
  };
  // sisa avatar yang tidak muat di baris — gelembung "+22" di ujungnya
  const sisaRekan = team.present - team.avatars.length;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        secondaryReady ? teamQuery.refetch() : Promise.resolve(),
      ]);
      void qc.invalidateQueries({ queryKey: ["announcements"], refetchType: "none" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        <YStack paddingHorizontal={18} paddingTop={insets.top + 10} gap={14}>
          <Card padding={18} borderRadius={28} overflow="hidden">
            <YStack
              position="absolute"
              width={116}
              height={116}
              borderRadius={58}
              backgroundColor="$accentSubtle"
              right={-24}
              top={-38}
              opacity={0.72}
              pointerEvents="none"
            />
            <YStack
              position="absolute"
              width={42}
              height={42}
              borderRadius={21}
              backgroundColor="$infoSubtle"
              right={84}
              bottom={-19}
              opacity={0.58}
              pointerEvents="none"
            />

            <XStack alignItems="center" justifyContent="space-between" gap={14}>
              <YStack flex={1} gap={8}>
                <Text fontSize={13.5} fontWeight="500" color="$fgMuted">
                  {sapaan()},
                </Text>
                <Text
                  fontSize={24}
                  lineHeight={29}
                  fontWeight="700"
                  color="$fg"
                  letterSpacing={-0.55}
                >
                  {data.profile.name}
                </Text>

                <XStack alignItems="center" flexWrap="wrap" gap={7}>
                  <XStack
                    alignItems="center"
                    gap={5}
                    backgroundColor="$accentSubtle"
                    borderRadius={14}
                    paddingHorizontal={9}
                    paddingVertical={6}
                  >
                    <Feather name="hash" size={12} color={theme.accent?.val} />
                    <Mono fontSize={11} fontWeight="600" color="$accent">
                      {data.profile.nik}
                    </Mono>
                  </XStack>
                  <XStack
                    maxWidth="100%"
                    alignItems="center"
                    gap={6}
                    backgroundColor="$inset"
                    borderRadius={14}
                    paddingHorizontal={9}
                    paddingVertical={6}
                  >
                    <Feather name="briefcase" size={12} color={theme.fgMuted?.val} />
                    <Text flexShrink={1} fontSize={11} fontWeight="500" color="$fgMuted">
                      {data.profile.division?.trim() || "Tanpa divisi"}
                    </Text>
                  </XStack>
                </XStack>
              </YStack>

              <YStack>
                <Avatar
                  seed={data.profile.id}
                  initials={data.profile.initials}
                  photoKey={isFocused ? data.profile.photoKey : null}
                  size={64}
                  borderWidth={3}
                  borderColor="$accent"
                  onPress={() => router.push("/pengaturan")}
                  pressStyle={{ opacity: 0.82, scale: 0.97 }}
                  accessibilityRole="button"
                  aria-label="Buka pengaturan"
                />
                <YStack
                  position="absolute"
                  right={-2}
                  bottom={-2}
                  width={22}
                  height={22}
                  borderRadius={11}
                  backgroundColor="$accentFill"
                  borderWidth={2}
                  borderColor="$surface"
                  alignItems="center"
                  justifyContent="center"
                  pointerEvents="none"
                >
                  <Feather name="chevron-right" size={12} color="#fff" />
                </YStack>
              </YStack>
            </XStack>
          </Card>

          <XStack gap={10}>
            <StatCard
              icon="check"
              fg="#fff"
              grad={GRAD.ungu}
              label="Status"
              value={clockedIn ? "Bekerja" : data.today.clockOut ? "Selesai" : "Belum absen"}
              sub="Hari ini"
            />
            <StatCard
              icon="calendar"
              fg="#fff"
              grad={GRAD.biru}
              label="Sisa cuti"
              value={`${data.leave.remaining} hari`}
              sub="Tahun ini"
            />
          </XStack>

          <Card padding={18} gap={14} borderRadius={28}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <Text fontSize={16.5} fontWeight="700" color="$fg" numberOfLines={1}>
                Kehadiran hari ini
              </Text>
              <Text
                flexShrink={1}
                fontSize={11.5}
                color="$fgMuted"
                backgroundColor="$inset"
                borderRadius={16}
                paddingHorizontal={11}
                paddingVertical={7}
                numberOfLines={1}
              >
                {tanggalPanjang(data.today.date)}
              </Text>
            </XStack>

            <XStack
              gap={12}
              alignItems="center"
              backgroundColor="$surface2"
              borderRadius={22}
              padding={14}
            >
              <YStack flex={1} gap={9}>
                <XStack
                  alignSelf="flex-start"
                  alignItems="center"
                  gap={6}
                  backgroundColor="$inset"
                  borderRadius={15}
                  paddingHorizontal={9}
                  paddingVertical={5}
                >
                  <Feather name="clock" size={12} color={theme.fgMuted?.val} />
                  <Text fontSize={11} fontWeight="500" color="$fgMuted">
                    Shift {data.shift.start}–{data.shift.end}
                  </Text>
                </XStack>

                <Text
                  fontSize={34}
                  lineHeight={40}
                  fontWeight="700"
                  color="$fg"
                  letterSpacing={-1.3}
                  fontVariant={["tabular-nums"]}
                  numberOfLines={1}
                >
                  {clock}
                </Text>

                {data.today.clockOut ? (
                  <YStack gap={2}>
                    <Text fontSize={11.5} color="$fgMuted" numberOfLines={1}>
                      Absen {data.today.clockIn?.slice(0, 5)}–{data.today.clockOut.slice(0, 5)}
                    </Text>
                    <Text fontSize={11.5} fontWeight="600" color="$accent">
                      Selesai hari ini
                    </Text>
                  </YStack>
                ) : clockedIn ? (
                  <Text fontSize={11.5} color="$accent" fontWeight="600" numberOfLines={2}>
                    Masuk {data.today.clockIn?.slice(0, 5)} ·{" "}
                    {data.today.location ?? "lokasi tidak dicatat"}
                  </Text>
                ) : (
                  <Text fontSize={11.5} color="$fgMuted" numberOfLines={2}>
                    Belum absen masuk hari ini
                  </Text>
                )}
              </YStack>

              <YStack alignItems="center" gap={5} width={108}>
                <Ring
                  progress={target ? kerja / target : 0}
                  size={104}
                  thickness={9}
                  colors={GRAD.hadir}
                  hole="$surface2"
                >
                  {data.today.clockOut ? (
                    <Feather name="check" size={34} color={GRAD.biru[0]} />
                  ) : (
                    <Mono fontSize={14} fontWeight="700" color="$fgMuted">
                      {target ? Math.round((Math.min(kerja, target) / target) * 100) : 0}%
                    </Mono>
                  )}
                </Ring>
                <XStack alignItems="baseline" gap={3}>
                  <Text fontSize={13} fontWeight="700" color="$fg">
                    {durasiJam(kerja)}
                  </Text>
                  <Text fontSize={11.5} color="$fgSubtle">
                    / {durasiJam(target)}
                  </Text>
                </XStack>
                <Text fontSize={10.5} color="$fgSubtle" textAlign="center">
                  Jam kerja
                </Text>
              </YStack>
            </XStack>

            {data.today.clockOut ? (
              <Btn
                width="100%"
                height={52}
                borderRadius={26}
                disabled
                icon={<Feather name="check-circle" size={18} color={theme.fgSubtle?.val} />}
              >
                <Text fontSize={14} fontWeight="600" color="$fgSubtle" numberOfLines={1}>
                  Absen hari ini selesai
                </Text>
              </Btn>
            ) : (
              <Btn
                width="100%"
                height={52}
                borderRadius={26}
                overflow="hidden"
                tone={clockedIn ? "danger" : undefined}
                icon={
                  <Feather
                    name={clockedIn ? "log-out" : "log-in"}
                    size={18}
                    color="#fff"
                  />
                }
                onPress={() => router.push("/absen")}
              >
                <Text fontSize={14} fontWeight="600" color="#fff" numberOfLines={1}>
                  {clockedIn ? "Absen keluar" : "Absen masuk sekarang"}
                </Text>
              </Btn>
            )}

            <XStack
              alignItems="center"
              gap={10}
              backgroundColor="$inset"
              borderRadius={18}
              paddingHorizontal={12}
              paddingVertical={10}
            >
              <YStack
                width={30}
                height={30}
                borderRadius={15}
                backgroundColor="$surface2"
                alignItems="center"
                justifyContent="center"
              >
                <Feather name="map-pin" size={14} color={theme.accent?.val} />
              </YStack>
              <Text fontSize={11.5} color="$fgMuted" flex={1} numberOfLines={1}>
                {data.offices.length === 1
                  ? `${data.offices[0].name} · radius ${data.offices[0].radiusM} m`
                  : data.offices.length
                    ? `${data.offices.length} titik absen tersedia`
                    : "Belum ada titik absen · tandai sebagai WFH"}
              </Text>
            </XStack>
          </Card>

          <XStack gap={10}>
            {quick.map((q) => (
              <Card
                key={q.label}
                flex={1}
                minHeight={94}
                borderRadius={24}
                paddingHorizontal={4}
                paddingTop={11}
                paddingBottom={10}
                gap={7}
                alignItems="center"
                justifyContent="center"
                pressStyle={{ backgroundColor: "$surface2", borderColor: "$accentLine", scale: 0.97 }}
                onPress={() => router.push(q.to)}
                accessibilityRole="button"
                aria-label={`Buka menu ${q.label}`}
              >
                <IconTile icon={q.icon} fg="#fff" grad={q.grad} size={50} radius={17} />
                <Text
                  width="100%"
                  fontSize={12.5}
                  lineHeight={16}
                  fontWeight="600"
                  color="$fg"
                  textAlign="center"
                >
                  {q.label}
                </Text>
              </Card>
            ))}
          </XStack>

          <Card padding={18} gap={14} borderRadius={28}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <Text fontSize={16.5} fontWeight="700" color="$fg">
                Rekan hadir hari ini
              </Text>
              <XStack
                alignItems="center"
                gap={4}
                backgroundColor="$accentSubtle"
                borderRadius={16}
                paddingHorizontal={11}
                paddingVertical={7}
                pressStyle={{ opacity: 0.7, scale: 0.98 }}
                onPress={() => router.push("/tim")}
                accessibilityRole="button"
                aria-label="Lihat tim"
              >
                <Text fontSize={11.5} fontWeight="600" color="$accent">
                  Lihat tim
                </Text>
                <Feather name="chevron-right" size={14} color={theme.accent?.val} />
              </XStack>
            </XStack>

            {teamQuery.isPending ? (
              <SkeletonRows count={2} lead={40} trail={false} />
            ) : team.avatars.length === 0 ? (
              <YStack backgroundColor="$surface2" borderRadius={22} padding={14} gap={12}>
                <XStack alignItems="center" gap={12}>
                  <IconTile icon="users" fg="#fff" grad={GRAD.biru} size={48} radius={16} />
                  <YStack flex={1} gap={3}>
                    <Text fontSize={13.5} fontWeight="600" color="$fg">
                      Belum ada rekan hadir
                    </Text>
                    <Text fontSize={11.5} lineHeight={16} color="$fgSubtle">
                      Rekan yang absen masuk akan muncul di sini.
                    </Text>
                  </YStack>
                </XStack>
                <XStack
                  alignItems="center"
                  justifyContent="space-between"
                  backgroundColor="$inset"
                  borderRadius={17}
                  paddingHorizontal={12}
                  paddingVertical={10}
                >
                  <Text fontSize={11.5} fontWeight="500" color="$fgMuted">
                    Kehadiran tim
                  </Text>
                  <XStack alignItems="baseline" gap={4}>
                    <Text fontSize={16} fontWeight="700" color="$fg">
                      {team.present}
                    </Text>
                    <Text fontSize={11.5} color="$fgSubtle">
                      dari {team.total}
                    </Text>
                  </XStack>
                </XStack>
              </YStack>
            ) : (
              <YStack gap={10}>
                <XStack
                  alignItems="center"
                  backgroundColor="$surface2"
                  borderRadius={22}
                  paddingHorizontal={10}
                  paddingVertical={14}
                >
                  <XStack flex={1} alignItems="center" justifyContent="space-around">
                    {team.avatars.map((t) => (
                      <YStack key={t.id} alignItems="center" gap={5} width={44}>
                        <YStack>
                          <Avatar
                            seed={t.id}
                            initials={t.initials}
                            photoKey={isFocused ? t.photoKey : null}
                            size={36}
                          />
                          <YStack
                            position="absolute"
                            right={-1}
                            bottom={-1}
                            width={11}
                            height={11}
                            borderRadius={6}
                            backgroundColor="$success"
                            borderWidth={2}
                            borderColor="$surface2"
                          />
                        </YStack>
                        {t.name ? (
                          <Text fontSize={9.5} color="$fgMuted" textAlign="center">
                            {t.name.split(" ")[0]}
                          </Text>
                        ) : null}
                      </YStack>
                    ))}
                    {sisaRekan > 0 ? (
                      <YStack
                        width={44}
                        height={44}
                        borderRadius={22}
                        backgroundColor="$inset"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Text fontSize={11.5} fontWeight="600" color="$fgMuted">
                          +{sisaRekan}
                        </Text>
                      </YStack>
                    ) : null}
                  </XStack>
                </XStack>
                <XStack
                  alignItems="center"
                  justifyContent="space-between"
                  backgroundColor="$inset"
                  borderRadius={17}
                  paddingHorizontal={12}
                  paddingVertical={10}
                >
                  <Text fontSize={11.5} fontWeight="500" color="$fgMuted">
                    Sudah absen masuk
                  </Text>
                  <XStack alignItems="baseline" gap={4}>
                    <Text fontSize={16} fontWeight="700" color="$fg">
                      {team.present}
                    </Text>
                    <Text fontSize={11.5} color="$fgSubtle">
                      dari {team.total} rekan
                    </Text>
                  </XStack>
                </XStack>
              </YStack>
            )}
          </Card>

          <Pengumuman preview={data.announcements} />
        </YStack>
      </ScrollView>
    </Screen>
  );
}

/**
 * The Beranda while /api/me is in flight.
 *
 * Ia mereplikasi geometri layar sungguhan — kartu, ubin, cincin — supaya layar
 * yang muncul saat peluncuran adalah layar yang kemudian menetap, dengan angkanya
 * yang terisi belakangan alih-alih seluruh tata letak berganti bentuk.
 */
function BerandaSkeleton() {
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <YStack paddingHorizontal={18} paddingTop={insets.top + 10} gap={14}>
        <Card padding={18} borderRadius={28}>
          <XStack alignItems="center" justifyContent="space-between" gap={14}>
            <YStack gap={9} flex={1}>
              <Skeleton width="34%" height={10} />
              <Skeleton width="68%" height={21} />
              <XStack gap={7}>
                <Skeleton width={72} height={27} radius={14} />
                <Skeleton width={92} height={27} radius={14} />
              </XStack>
            </YStack>
            <Skeleton width={64} height={64} radius={32} />
          </XStack>
        </Card>

        <XStack gap={10}>
          {[0, 1].map((i) => (
            <Card key={i} flex={1} minHeight={80} padding={12} justifyContent="center">
              <XStack alignItems="center" gap={8}>
                <Skeleton width={52} height={52} radius={16} />
                <YStack flex={1} height={52} justifyContent="space-between">
                  <Skeleton width="58%" height={9} />
                  <Skeleton width="78%" height={14} />
                  <Skeleton width="52%" height={8} />
                </YStack>
              </XStack>
            </Card>
          ))}
        </XStack>

        <Card padding={18} gap={14} borderRadius={28}>
          <XStack alignItems="center" justifyContent="space-between">
            <Skeleton width="42%" height={14} />
            <Skeleton width="37%" height={28} radius={14} />
          </XStack>
          <XStack
            gap={12}
            alignItems="center"
            backgroundColor="$surface2"
            borderRadius={22}
            padding={14}
          >
            <YStack flex={1} gap={10}>
              <Skeleton width="68%" height={24} radius={12} />
              <Skeleton width="88%" height={31} radius={8} />
              <Skeleton width="76%" height={10} />
            </YStack>
            <Skeleton width={104} height={104} radius={52} />
          </XStack>
          <Skeleton height={52} radius={26} />
          <Skeleton height={50} radius={18} />
        </Card>

        <XStack gap={10}>
          {[0, 1, 2, 3].map((i) => (
            <Card
              key={i}
              flex={1}
              minHeight={94}
              borderRadius={24}
              paddingVertical={10}
              alignItems="center"
              justifyContent="center"
              gap={7}
            >
              <Skeleton width={50} height={50} radius={17} />
              <Skeleton width="54%" height={10} />
            </Card>
          ))}
        </XStack>

        <Card padding={18} gap={14} borderRadius={28}>
          <XStack alignItems="center" justifyContent="space-between">
            <Skeleton width="46%" height={14} />
            <Skeleton width={74} height={28} radius={14} />
          </XStack>
          <YStack backgroundColor="$surface2" borderRadius={22} padding={14} gap={12}>
            <XStack justifyContent="space-around">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} width={36} height={36} radius={18} />
              ))}
            </XStack>
            <Skeleton height={36} radius={17} />
          </YStack>
        </Card>
      </YStack>
    </Screen>
  );
}
