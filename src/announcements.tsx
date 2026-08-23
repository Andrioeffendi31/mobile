import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Paragraph, Text, XStack, YStack, useTheme } from "tamagui";
import {
  API,
  type Announcements,
  type Bootstrap,
  get,
  useSession,
} from "@/api";
import { cat, GRAD, tint } from "@/theme";
import {
  Badge,
  Btn,
  Card,
  IconTile,
  Note,
  SheetShell,
  SkeletonRows,
} from "@/ui";

type Item = Announcements["items"][number];
/** jarak antar kartu carousel; ikut dihitung ke snapToInterval */
const JEDA_KARTU = 12;
type Preview = Bootstrap["announcements"][number];

/**
 * The announcement feed at the foot of the Beranda (moved here from the old Info
 * tab, and out of index.tsx so the screen file stays about the day's work).
 *
 * Each card carries the title and one meta line — enough to decide whether to
 * read it. The body used to be printed in full on every card, which turned the
 * bottom of the home screen into a wall of text nobody scrolled past; it now
 * lives in a sheet, one tap away.
 */
export function Pengumuman({ preview }: { preview: Preview[] }) {
  const theme = useTheme();
  // two pieces of state, not one nullable item: the sheet animates out, and
  // dropping the item on close would empty the frame while it is still sliding
  const [detail, setDetail] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["announcements"],
    queryFn: ({ signal }) =>
      get<Announcements>("/api/me/announcements", { signal }),
    /**
     * Dulu `false`: /api/me sudah membawa dua baris untuk pratinjau Beranda, dan
     * umpan 50 barisnya hanya diambil kalau ada yang memintanya.
     *
     * Carousel mengubah syaratnya. Dua kartu bukan carousel, dan bannernya
     * memang barang yang datang dari umpan itu. Jadi ia diambil sekali saat
     * kartunya ter-mount — pratinjau bootstrap tetap yang mengecat lebih dulu,
     * jadi tidak ada layar kosong yang menunggu jaringan.
     */
    enabled: true,
  });

  const [lebar, setLebar] = useState(0);
  const [aktif, setAktif] = useState(0);
  const ukur = useCallback((e: LayoutChangeEvent) => {
    setLebar(e.nativeEvent.layout.width);
  }, []);

  const items: (Item | Preview)[] = q.data?.items ?? preview;

  /**
   * Isi lengkapnya — badan pengumuman dan bannernya — hanya ada di umpan, bukan
   * di pratinjau bootstrap. Umpannya sudah diambil saat kartunya ter-mount, tapi
   * ketukan bisa datang lebih cepat daripada jaringannya, jadi jalur ini tetap
   * menunggu alih-alih membuka lembar yang isinya separuh.
   */
  const loadAll = async () => {
    if (q.data) return q.data.items;
    const result = await q.refetch();
    return result.data?.items ?? [];
  };

  const openDetail = async (id: number) => {
    const full = (await loadAll()).find((item) => item.id === id);
    if (!full) return;
    setDetail(full);
    setOpen(true);
  };

  return (
    // Satu kartu berisi carousel pengumuman: banner, judul, dan metanya. Isi
    // lengkapnya satu ketukan lagi, di lembar detail.
    <Card padding={18} gap={14} borderRadius={28}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <Text fontSize={16.5} fontWeight="700" color="$fg">
          Pengumuman
        </Text>
        {/* Tidak ada lagi "Lihat semua": semuanya bisa dicapai dengan menggeser
            carousel di bawah, dan tombol yang membuka apa yang sudah terbuka
            hanya menambah satu hal untuk dipahami. */}
        {items.length > 1 ? (
          <Text fontSize={11.5} color="$fgSubtle">
            {aktif + 1}/{items.length}
          </Text>
        ) : null}
      </XStack>

      {q.isFetching && items.length === 0 ? (
        <SkeletonRows count={2} lead={32} trail={false} />
      ) : q.isError && items.length === 0 ? (
        // the Beranda already reports a failed bootstrap loudly; a second red
        // panel for the feed would bury the rest of the screen
        <Note
          text="Pengumuman gagal dimuat. Tarik ke bawah untuk memuat ulang."
          fg="$warning"
          bg="$warningSubtle"
        />
      ) : items.length === 0 ? (
        <XStack
          alignItems="center"
          gap={12}
          padding={14}
          borderRadius={22}
          backgroundColor="$surface2"
        >
          <IconTile
            icon="bell"
            fg="#fff"
            grad={GRAD.ungu}
            size={50}
            radius={17}
          />
          <YStack flex={1} gap={3}>
            <Text fontSize={13.5} fontWeight="600" color="$fg">
              Belum ada pengumuman
            </Text>
            <Text fontSize={11.5} lineHeight={16} color="$fgSubtle">
              Pengumuman akan muncul di sini.
            </Text>
          </YStack>
        </XStack>
      ) : (
        /**
         * Lebarnya diukur, bukan dihitung dari lebar layar: kartu ini punya
         * padding sendiri dan bisa dipakai ulang di tempat lain, jadi menebak
         * `Dimensions.get()` dikurangi angka-angka yang dihafal akan meleset
         * begitu paddingnya berubah.
         */
        <YStack onLayout={ukur}>
          {lebar > 0 ? (
            <>
              <FlatList
                data={items}
                keyExtractor={(a) => String(a.id)}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                // satu kartu penuh per geseran, bukan bebas berhenti di tengah
                snapToInterval={lebar + JEDA_KARTU}
                snapToAlignment="start"
                onMomentumScrollEnd={(e) =>
                  setAktif(
                    Math.round(
                      e.nativeEvent.contentOffset.x / (lebar + JEDA_KARTU),
                    ),
                  )
                }
                ItemSeparatorComponent={() => <YStack width={JEDA_KARTU} />}
                renderItem={({ item: a }) => (
                  <KartuPengumuman
                    a={a}
                    lebar={lebar}
                    onPress={() => void openDetail(a.id)}
                  />
                )}
              />
              {items.length > 1 ? (
                <XStack
                  alignSelf="center"
                  gap={6}
                  marginTop={12}
                  accessibilityRole="progressbar"
                  aria-label={`Pengumuman ${aktif + 1} dari ${items.length}`}
                >
                  {items.map((a, n) => (
                    <YStack
                      key={a.id}
                      width={n === aktif ? 18 : 6}
                      height={6}
                      borderRadius={3}
                      backgroundColor={n === aktif ? "$accent" : "$lineStrong"}
                    />
                  ))}
                </XStack>
              ) : null}
            </>
          ) : null}
        </YStack>
      )}

      <Detail item={detail} open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

/**
 * Satu kartu carousel: banner di atas, judul dan metanya di bawah.
 *
 * Pengumuman TANPA banner tetap mendapat kartu setinggi yang sama, dengan petak
 * berwarna kategori sebagai ganti gambarnya — kalau tidak, carousel yang isinya
 * campur akan naik-turun tingginya tiap kali digeser.
 *
 * Bannernya `cover` di sini, bukan `contain` seperti di lembar detail: petaknya
 * pratinjau berukuran tetap, dan yang dicari mata saat menggeser adalah warna
 * dan bentuk, bukan gambar utuhnya. Yang utuh ada satu ketukan lagi.
 */
function KartuPengumuman({
  a,
  lebar,
  onPress,
}: {
  a: Item | Preview;
  lebar: number;
  onPress: () => void;
}) {
  const tone = cat(a.category);
  const cookie = useSession((st) => st.cookie);
  const disematkan = "pinned" in a && a.pinned;

  return (
    <YStack
      width={lebar}
      borderRadius={22}
      overflow="hidden"
      backgroundColor="$surface2"
      borderWidth={1}
      borderColor={disematkan ? "$accentLine" : "transparent"}
      pressStyle={{ opacity: 0.85 }}
      onPress={onPress}
      accessibilityRole="button"
      aria-label={`${a.title}. ${a.date}. ${a.category}. Buka detail`}
    >
      {a.bannerKey ? (
        <Image
          source={{
            uri: `${API}/api/files/${a.bannerKey}`,
            ...(cookie ? { headers: { cookie } } : {}),
          }}
          style={{ width: "100%", aspectRatio: 16 / 9 }}
          resizeMode="cover"
          accessibilityLabel={`Banner ${a.title}`}
        />
      ) : (
        <YStack
          width="100%"
          aspectRatio={16 / 9}
          backgroundColor={tone.bg}
          alignItems="center"
          justifyContent="center"
        >
          <Feather name="volume-2" size={30} color={tint(tone.fg)} />
        </YStack>
      )}

      <YStack padding={14} gap={6}>
        <XStack alignItems="center" gap={7} flexWrap="wrap">
          <Badge label={a.category} fg={tone.fg} bg={tone.bg} />
          {disematkan ? (
            <Badge label="Penting" fg="$warning" bg="$warningSubtle" />
          ) : null}
        </XStack>
        <Text fontSize={14} fontWeight="700" color="$fg" numberOfLines={2}>
          {a.title}
        </Text>
        <Text fontSize={11.5} color="$fgSubtle">
          {a.date}
        </Text>
      </YStack>
    </YStack>
  );
}

/**
 * The full text. No request of its own: the list response already carries every
 * field this shows, so opening a detail is free and works offline for anything
 * already on screen.
 */
function Detail({
  item,
  open,
  onClose,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
}) {
  const tone = item ? cat(item.category) : null;
  /**
   * Banner dilayani /api/files yang memeriksa sesi tiap permintaan, bukan URL
   * bertanda tangan — jadi cookienya ikut sebagai header pada permintaan
   * gambarnya sendiri, persis seperti foto profil di ui.tsx dan selfie di
   * attendance-detail.tsx. Tidak ada URL yang kedaluwarsa semenit setelah
   * sheetnya dibuka.
   */
  const cookie = useSession((st) => st.cookie);
  /** rasio banner, diketahui hanya setelah gambarnya dimuat; 16:9 sementara */
  const [rasio, setRasio] = useState(16 / 9);
  // sheetnya dipakai ulang untuk tiap pengumuman, jadi rasio milik gambar
  // sebelumnya harus dilupakan — kalau tidak, banner berikutnya sempat tampil
  // pada bentuk yang bukan miliknya sampai onLoad-nya menyusul
  useEffect(() => setRasio(16 / 9), [item?.bannerKey]);

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={item?.title ?? ""}
      footer={
        <Btn flex={1} tone="ghost" onPress={onClose}>
          Tutup
        </Btn>
      }
    >
      {item && tone ? (
        <>
          <XStack alignItems="center" gap={7} flexWrap="wrap">
            <Badge label={item.category} fg={tone.fg} bg={tone.bg} />
            {item.pinned ? (
              <Badge label="Penting" fg="$warning" bg="$warningSubtle" />
            ) : null}
            <Text fontSize={11.5} color="$fgSubtle">
              {item.author} · {item.date}
            </Text>
          </XStack>
          {item.bannerKey ? (
            /**
             * Utuh pada rasio aslinya, bukan dipotong.
             *
             * Rasionya tidak bisa diketahui sebelum gambarnya dimuat — server
             * hanya mengirim kuncinya — jadi `onLoad` yang memberitahukannya, dan
             * sampai saat itu 16:9 dipakai sebagai tempat duduk sementara supaya
             * sheetnya tidak melompat. Sudut 20 menyamai kartu di daftar atasnya,
             * bukan angka baru.
             */
            <Image
              source={{
                uri: `${API}/api/files/${item.bannerKey}`,
                ...(cookie ? { headers: { cookie } } : {}),
              }}
              onLoad={(e) => {
                const { width, height } = e.nativeEvent.source;
                if (width > 0 && height > 0) setRasio(width / height);
              }}
              style={{ width: "100%", aspectRatio: rasio, borderRadius: 20 }}
              resizeMode="contain"
              accessibilityLabel={`Banner ${item.title}`}
            />
          ) : null}
          <Paragraph fontSize={13.5} color="$fgMuted" lineHeight={21}>
            {item.body}
          </Paragraph>
        </>
      ) : null}
    </SheetShell>
  );
}
