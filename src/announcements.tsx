import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Paragraph, Text, XStack, YStack, useTheme } from "tamagui";
import { type Announcements, type Bootstrap, get } from "@/api";
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
  const [expanded, setExpanded] = useState(false);
  const q = useQuery({
    queryKey: ["announcements"],
    queryFn: ({ signal }) => get<Announcements>("/api/me/announcements", { signal }),
    // /api/me already carries the two rows needed by the Home preview. Fetch the
    // 50-row body feed only when somebody asks to read or expand it.
    enabled: false,
  });

  const items: (Item | Preview)[] = q.data?.items ?? preview;

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
    // Satu kartu yang memuat judul dan preview pertama, seperti rancangan Home.
    // "Lihat semua" membuka sisanya inline karena belum ada layar daftar khusus.
    <Card padding={18} gap={14} borderRadius={28}>
      <XStack alignItems="center" justifyContent="space-between" gap={10}>
        <Text fontSize={16.5} fontWeight="700" color="$fg">
          Pengumuman
        </Text>
        <XStack
          alignItems="center"
          gap={4}
          backgroundColor="$accentSubtle"
          borderRadius={16}
          paddingHorizontal={11}
          paddingVertical={7}
          onPress={() => {
            if (expanded) {
              setExpanded(false);
              return;
            }
            void loadAll().then((loaded) => {
              if (loaded.length) setExpanded(true);
            });
          }}
          pressStyle={{ opacity: 0.7, scale: 0.98 }}
          accessibilityRole="button"
          aria-label={expanded ? "Ringkas pengumuman" : "Lihat semua pengumuman"}
        >
          <Text fontSize={11.5} fontWeight="600" color="$accent">
            {expanded ? "Ringkas" : "Lihat semua"}
          </Text>
          <Feather
            name={expanded ? "chevron-up" : "chevron-right"}
            size={14}
            color={theme.accent?.val}
          />
        </XStack>
      </XStack>

      {q.isFetching && items.length === 0 ? (
        <SkeletonRows count={3} lead={32} trail={false} />
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
          <IconTile icon="bell" fg="#fff" grad={GRAD.ungu} size={50} radius={17} />
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
        (expanded ? items : items.slice(0, 1)).map((a) => {
          const tone = cat(a.category);
          return (
            <XStack
              key={a.id}
              alignItems="center"
              gap={12}
              padding={14}
              borderRadius={20}
              backgroundColor="$surface2"
              borderWidth={1}
              borderColor={"pinned" in a && a.pinned ? "$accentLine" : "transparent"}
              pressStyle={{ backgroundColor: "$inset" }}
              onPress={() => void openDetail(a.id)}
              accessibilityRole="button"
              aria-label={`${a.title}. ${a.date}. ${a.category}. Buka detail`}
            >
              <YStack
                width={44}
                height={44}
                borderRadius={15}
                backgroundColor={tone.bg}
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
              >
                <Feather name="volume-2" size={19} color={tint(tone.fg)} />
              </YStack>
              <YStack flex={1} gap={3}>
                <Text fontSize={13.5} fontWeight="600" color="$fg">
                  {a.title}
                </Text>
                <Text fontSize={11.5} lineHeight={16} color="$fgSubtle">
                  {a.date} · {a.category}
                </Text>
              </YStack>
              {"pinned" in a && a.pinned ? (
                <Badge label="Penting" fg="$warning" bg="$warningSubtle" />
              ) : null}
              <Feather name="chevron-right" size={15} color={theme.fgSubtle?.val} />
            </XStack>
          );
        })
      )}

      <Detail item={detail} open={open} onClose={() => setOpen(false)} />
    </Card>
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
            {item.pinned ? <Badge label="Penting" fg="$warning" bg="$warningSubtle" /> : null}
            <Text fontSize={11.5} color="$fgSubtle">
              {item.author} · {item.date}
            </Text>
          </XStack>
          <Paragraph fontSize={13.5} color="$fgMuted" lineHeight={21}>
            {item.body}
          </Paragraph>
        </>
      ) : null}
    </SheetShell>
  );
}
