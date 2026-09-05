import { useCallback, useState } from "react";
import { Image, RefreshControl, type ImageSourcePropType } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type Leaderboard, type LeaderboardRow, get } from "@/api";
import {
  Avatar,
  Empty,
  ErrorNote,
  Mono,
  PageIntro,
  Screen,
  Skeleton,
  StickyHeader,
  useStickyHeader,
} from "@/ui";

type Period = Leaderboard["period"];

const PERIODS: { value: Period; label: string; sub: string }[] = [
  { value: "week", label: "Mingguan", sub: "Lihat pencapaian terbaik minggu ini." },
  { value: "month", label: "Bulanan", sub: "Lihat pencapaian terbaik bulan ini." },
  { value: "all", label: "Semua", sub: "Pencapaian sejak aplikasi mulai mencatat." },
];

const CROWN = require("../../../assets/leaderboard/crown.png");
const SPRINKLES = require("../../../assets/leaderboard/sprinkles.png");
const MEDALS: Record<1 | 2 | 3, ImageSourcePropType> = {
  1: require("../../../assets/leaderboard/medal-gold.png"),
  2: require("../../../assets/leaderboard/medal-silver.png"),
  3: require("../../../assets/leaderboard/medal-bronze.png"),
};

const POINT_FORMAT = new Intl.NumberFormat("id-ID");

/**
 * Papan peringkat kehadiran.
 *
 * Angkanya datang dari /api/me/leaderboard, yang menghitungnya dengan
 * `rekapSql()` yang sama dengan Rekap Kehadiran di konsol web — bukan kueri
 * kedua yang kebetulan mirip. Papan peringkat yang angkanya berbeda dari
 * laporan resmi akan membuat orang memperdebatkan peringkatnya, bukan
 * kehadirannya.
 *
 * Poin TIDAK dihitung di sini: bobotnya kebijakan perusahaan, dan aplikasi yang
 * sudah terpasang di ponsel orang bukan tempat menyimpan aturan yang bisa
 * berubah.
 */
export default function Tim() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>("week");
  /* 56, sama dengan Pengaturan: ambangnya seukuran judul besar yang digantikan,
     bukan angka yang menyisakan ruang di atasnya. */
  const bar = useStickyHeader(56);

  const q = useQuery({
    queryKey: ["leaderboard", period],
    queryFn: ({ signal }) =>
      get<Leaderboard>(`/api/me/leaderboard?period=${period}`, { signal }),
  });

  // kembali ke tab ini sesudah absen: peringkatnya harus sudah ikut berubah
  useFocusEffect(
    useCallback(() => {
      void q.refetch();
    }, [q.refetch]),
  );

  const ranked = q.data?.leaders ?? [];
  const current = q.data?.me ?? null;
  /**
   * Podium: [kedua, pertama, ketiga] — juara di tengah dan paling tinggi.
   * `filter(Boolean)` bukan hiasan: perusahaan yang baru mulai bisa punya
   * kurang dari tiga orang berperingkat, dan mengakses `ranked[2]` yang
   * undefined akan mengosongkan seluruh layar.
   */
  const top = [ranked[1], ranked[0], ranked[2]].filter(
    (x): x is LeaderboardRow => Boolean(x),
  );
  const hariIni = q.data?.hariIni;
  const sub = PERIODS.find((p) => p.value === period)!.sub;

  /**
   * Latar bawaan Screen ($bg), bukan $surface.
   *
   * Layar ini satu-satunya tab yang dulu menimpanya jadi putih — warisan
   * rancangan dummy — dan itu membuat StickyHeader di bawah, yang memakai $bg,
   * tampil sebagai strip ABU di atas halaman PUTIH: terlihat seperti bar asing,
   * bukan seperti kepala halaman itu sendiri. Kartu di dalamnya sudah $surface,
   * jadi kontrasnya justru benar di atas $bg — sama seperti Pengaturan.
   */
  return (
    <Screen>
      <ScrollView
        onScroll={bar.onScroll}
        scrollEventThrottle={bar.scrollEventThrottle}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching && !q.isLoading}
            onRefresh={() => void q.refetch()}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: insets.top + 18,
          paddingBottom: 142,
        }}
      >
        {/* PageIntro yang sama dengan Kehadiran — dua layar dengan bentuk yang
            sama tidak boleh punya dua judul besar yang ukurannya beda tipis. */}
        <YStack marginBottom={16}>
          <PageIntro title="Peringkat tim" subtitle={sub} />
        </YStack>

        <PeriodTabs value={period} onChange={setPeriod} />

        {hariIni ? <TimHariIni counts={hariIni} /> : null}

        {q.isError ? (
          <ErrorNote
            message={(q.error as Error).message}
            onRetry={() => void q.refetch()}
          />
        ) : q.isLoading ? (
          <YStack gap={12} marginTop={26}>
            <Skeleton height={150} radius={20} />
            <Skeleton height={58} radius={16} />
            <Skeleton height={58} radius={16} />
            <Skeleton height={58} radius={16} />
          </YStack>
        ) : ranked.length === 0 ? (
          /* penyebutnya nol dan datanya kosong adalah dua sebab berbeda, dan
             keduanya wajar — kalimatnya menyebut yang mana */
          <Empty
            text={
              q.data?.hariKerja === 0
                ? "Belum ada hari kerja pada periode ini."
                : "Belum ada catatan kehadiran pada periode ini."
            }
          />
        ) : (
          <>
        <XStack alignItems="flex-end" marginTop={26} marginBottom={28}>
          {top.map((leader) => (
            <Podium key={leader.rank} leader={leader} />
          ))}
        </XStack>

        <XStack alignItems="center" justifyContent="space-between" marginBottom={9}>
          <Text fontSize={17} lineHeight={22} fontWeight="700" color="$fg">
            Peringkat lainnya
          </Text>
          <Text
            fontSize={13}
            lineHeight={20}
            fontWeight="600"
            color="$accent"
            onPress={() => setPeriod("all")}
            pressStyle={{ opacity: 0.55 }}
            accessibilityRole="button"
            aria-label="Tampilkan peringkat semua waktu"
          >
            Lihat semua
          </Text>
        </XStack>

        <YStack borderTopWidth={1} borderTopColor="$line">
          {ranked.slice(3).map((leader, index) => (
            <Baris
              key={leader.id}
              leader={leader}
              aku={leader.id === current?.id}
              last={index === ranked.length - 4}
            />
          ))}
        </YStack>
          </>
        )}
      </ScrollView>

      {current ? (
        <CurrentUserCard leader={current} dari={q.data!.peringkatDari} />
      ) : null}
      <StickyHeader shown={bar.shown} title="Peringkat tim" />
    </Screen>
  );
}

/**
 * Ringkasan kehadiran seluruh karyawan HARI INI.
 *
 * Inilah yang dipertahankan dari papan "Kehadiran Tim" yang dulu menempati tab
 * ini: yang berguna sehari-hari adalah "berapa banyak", bukan "siapa" — dan
 * "siapa" sudah ada di konsol HR.
 *
 * Keempatnya nol berarti hari ini bukan hari kerja siapa pun (akhir pekan atau
 * libur nasional). Itu keadaan yang sah, dan menampilkan empat angka nol tanpa
 * penjelasan akan terbaca seperti gagal memuat.
 */
function TimHariIni({
  counts,
}: {
  counts: { hadir: number; telat: number; izin: number; belum: number };
}) {
  const total = counts.hadir + counts.telat + counts.izin + counts.belum;
  const items = [
    { label: "Hadir", value: counts.hadir, color: "$success" as const },
    { label: "Telat", value: counts.telat, color: "$warning" as const },
    { label: "Izin", value: counts.izin, color: "$accent" as const },
    { label: "Belum", value: counts.belum, color: "$fgMuted" as const },
  ];

  return (
    <YStack
      marginTop={16}
      borderRadius={16}
      borderWidth={1}
      borderColor="$line"
      backgroundColor="$surface"
      paddingVertical={11}
      paddingHorizontal={14}
    >
      <Text fontSize={11.5} lineHeight={16} fontWeight="600" color="$fgMuted" marginBottom={8}>
        Tim hari ini
      </Text>
      {total === 0 ? (
        <Text fontSize={13} lineHeight={18} color="$fgMuted">
          Hari ini bukan hari kerja.
        </Text>
      ) : (
        <XStack>
          {items.map((it) => (
            <YStack key={it.label} flex={1} gap={1}>
              <Mono fontSize={18} lineHeight={22} fontWeight="700" color={it.color}>
                {it.value}
              </Mono>
              <Text fontSize={11} lineHeight={15} color="$fgMuted">
                {it.label}
              </Text>
            </YStack>
          ))}
        </XStack>
      )}
    </YStack>
  );
}

function PeriodTabs({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <XStack height={48} padding={4} borderRadius={18} backgroundColor="$inset" gap={3}>
      {PERIODS.map((item) => {
        const selected = value === item.value;
        return (
          <YStack
            key={item.value}
            flex={1}
            borderRadius={14}
            alignItems="center"
            justifyContent="center"
            backgroundColor={selected ? "$surface" : "transparent"}
            shadowColor="#14161b"
            shadowOpacity={selected ? 0.06 : 0}
            shadowRadius={selected ? 7 : 0}
            shadowOffset={{ width: 0, height: 2 }}
            onPress={() => onChange(item.value)}
            pressStyle={{ scale: 0.98, opacity: 0.72 }}
            accessibilityRole="button"
            aria-selected={selected}
          >
            <Text
              fontSize={13}
              fontWeight={selected ? "700" : "500"}
              color={selected ? "$accent" : "$fgMuted"}
            >
              {item.label}
            </Text>
          </YStack>
        );
      })}
    </XStack>
  );
}

function Podium({ leader }: { leader: LeaderboardRow }) {
  const winner = leader.rank === 1;
  const avatarSize = winner ? 94 : 72;

  return (
    <YStack flex={1} alignItems="center" paddingHorizontal={3}>
      <YStack alignItems="center" marginBottom={16}>
        {winner ? (
          <Image
            source={CROWN}
            style={{ width: 36, height: 24, marginBottom: 6 }}
            resizeMode="contain"
            accessibilityLabel="Mahkota peringkat pertama"
          />
        ) : (
          <YStack height={30} />
        )}
        {winner ? (
          <Image
            source={SPRINKLES}
            style={{
              position: "absolute",
              top: 22,
              width: 142,
              height: 80,
            }}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
        <Avatar
          seed={leader.id}
          initials={leader.initials}
          photoKey={leader.photoKey}
          size={avatarSize}
          borderRadius={winner ? 29 : 23}
          borderWidth={winner ? 1.5 : 1}
          borderColor={winner ? "$accentLine" : "$line"}
        />
        <Medal rank={leader.rank} />
      </YStack>
      <Text
        maxWidth="100%"
        fontSize={winner ? 16 : 14}
        lineHeight={20}
        fontWeight="700"
        letterSpacing={-0.3}
        color="$fg"
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {leader.name}
      </Text>
      <XStack alignItems="baseline" justifyContent="center" gap={3} marginTop={4}>
        <Mono fontSize={winner ? 17 : 15} lineHeight={22} fontWeight="700" color="$accent">
          {POINT_FORMAT.format(leader.poin)}
        </Mono>
        <Text fontSize={11.5} color="$fgMuted">
          poin
        </Text>
      </XStack>
    </YStack>
  );
}

function Medal({ rank }: { rank: number }) {
  const place = rank as 1 | 2 | 3;
  const textColor = place === 1 ? "#7a4b00" : place === 2 ? "#475467" : "#713515";

  return (
    <YStack
      position="absolute"
      bottom={-20}
      width={42}
      height={46}
      alignItems="center"
    >
      <Image
        source={MEDALS[place]}
        style={{ position: "absolute", width: 42, height: 46 }}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Mono marginTop={10} fontSize={14} lineHeight={18} fontWeight="700" color={textColor}>
        {rank}
      </Mono>
    </YStack>
  );
}

function Baris({
  leader,
  aku,
  last,
}: {
  leader: LeaderboardRow;
  aku: boolean;
  last: boolean;
}) {
  return (
    <XStack
      minHeight={68}
      alignItems="center"
      gap={12}
      borderBottomWidth={last ? 0 : 1}
      borderBottomColor="$line"
      paddingVertical={10}
      // baris sendiri disorot, bukan disembunyikan: kartu di bawah adalah
      // ringkasan, dan orang tetap perlu melihat posisinya di antara tetangganya
      backgroundColor={aku ? "$accentSubtle" : "transparent"}
    >
      <Mono width={22} fontSize={17} lineHeight={22} fontWeight="700" color="$fg">
        {leader.rank}
      </Mono>
      <Avatar
        seed={leader.id}
        initials={leader.initials}
        photoKey={leader.photoKey}
        size={44}
        borderRadius={14}
      />
      <YStack flex={1} gap={2}>
        <Text fontSize={14} lineHeight={18} fontWeight="600" color="$fg" numberOfLines={1}>
          {leader.name}
        </Text>
        <Text fontSize={11.5} lineHeight={16} color="$fgMuted">
          {leader.tepatWaktu} hari tepat waktu
        </Text>
      </YStack>
      <XStack alignItems="baseline" gap={3}>
        <Mono fontSize={15.5} lineHeight={20} fontWeight="700" color="$fg">
          {POINT_FORMAT.format(leader.poin)}
        </Mono>
        <Text fontSize={11} color="$fgMuted">
          poin
        </Text>
      </XStack>
    </XStack>
  );
}

function CurrentUserCard({
  leader,
  dari,
}: {
  leader: LeaderboardRow;
  dari: number;
}) {
  return (
    <YStack
      position="absolute"
      left={16}
      right={16}
      bottom={10}
      borderRadius={22}
      borderWidth={1}
      borderColor="$accentLine"
      backgroundColor="$surface"
      paddingHorizontal={14}
      paddingTop={10}
      paddingBottom={11}
      shadowColor="#101828"
      shadowOpacity={0.12}
      shadowRadius={16}
      shadowOffset={{ width: 0, height: 6 }}
    >
      <Text fontSize={12.5} lineHeight={17} fontWeight="700" color="$accent" marginBottom={7}>
        Peringkat kamu
      </Text>
      <XStack alignItems="center" gap={11}>
        <Mono width={20} fontSize={17} fontWeight="700" color="$fg">
          {leader.rank}
        </Mono>
        <Avatar
          seed={leader.id}
          initials={leader.initials}
          photoKey={leader.photoKey}
          size={42}
          borderRadius={14}
        />
        <YStack flex={1} gap={2}>
          <Text fontSize={14} lineHeight={18} fontWeight="700" color="$fg" numberOfLines={1}>
            {leader.name}
          </Text>
          <Text fontSize={11.5} color="$fgMuted">
            {leader.tepatWaktu} hari tepat waktu
          </Text>
        </YStack>
        <XStack alignItems="baseline" gap={3}>
          <Mono fontSize={16} lineHeight={21} fontWeight="700" color="$fg">
            {POINT_FORMAT.format(leader.poin)}
          </Mono>
          <Text fontSize={11} color="$fgMuted">
            poin
          </Text>
        </XStack>
      </XStack>
      {/* Seberapa jauh di atas yang lain — bukan angka hias. Peringkat 1 dari 15
          mengisi penuh, peringkat terakhir hampir kosong. */}
      <YStack
        height={4}
        borderRadius={2}
        backgroundColor="$inset"
        overflow="hidden"
        marginTop={9}
        marginLeft={31}
      >
        <YStack
          width={`${Math.round(((dari - leader.rank + 1) / Math.max(dari, 1)) * 100)}%`}
          height="100%"
          borderRadius={2}
          backgroundColor="$accentFill"
        />
      </YStack>
    </YStack>
  );
}
