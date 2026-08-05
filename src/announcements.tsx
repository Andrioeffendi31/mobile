import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Paragraph, Text, XStack, YStack } from "tamagui";
import { type Announcements, get } from "@/api";
import { cat, tint } from "@/theme";
import { Badge, Btn, Card, Note, SectionLabel, SheetShell, SkeletonRows } from "@/ui";

type Item = Announcements["items"][number];

/**
 * The announcement feed at the foot of the Beranda (moved here from the old Info
 * tab, and out of index.tsx so the screen file stays about the day's work).
 *
 * Each card carries the title and one meta line — enough to decide whether to
 * read it. The body used to be printed in full on every card, which turned the
 * bottom of the home screen into a wall of text nobody scrolled past; it now
 * lives in a sheet, one tap away.
 */
export function Pengumuman() {
  // two pieces of state, not one nullable item: the sheet animates out, and
  // dropping the item on close would empty the frame while it is still sliding
  const [detail, setDetail] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["announcements"],
    queryFn: () => get<Announcements>("/api/me/announcements"),
  });

  return (
    <YStack gap={9}>
      <SectionLabel>Pengumuman</SectionLabel>

      {q.isPending ? (
        <SkeletonRows count={3} lead={32} trail={false} />
      ) : q.isError ? (
        // the Beranda already reports a failed bootstrap loudly; a second red
        // panel for the feed would bury the rest of the screen
        <Note
          text="Pengumuman gagal dimuat. Tarik ke bawah untuk memuat ulang."
          fg="$warning"
          bg="$warningSubtle"
        />
      ) : q.data.items.length === 0 ? (
        <Note text="Belum ada pengumuman." fg="$fgMuted" bg="$inset" />
      ) : (
        q.data.items.map((a) => {
          const tone = cat(a.category);
          return (
            <Card
              key={a.id}
              flexDirection="row"
              alignItems="center"
              gap={11}
              paddingHorizontal={14}
              paddingVertical={12}
              borderColor={a.pinned ? "$accentLine" : "$line"}
              pressStyle={{ backgroundColor: "$surface2" }}
              onPress={() => {
                setDetail(a);
                setOpen(true);
              }}
              accessibilityRole="button"
              aria-label={`${a.title}. ${a.date}. ${a.category}. Buka detail`}
            >
              <YStack
                width={32}
                height={32}
                borderRadius={10}
                backgroundColor={tone.bg}
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
              >
                <Feather name="volume-2" size={15} color={tint(tone.fg)} />
              </YStack>
              <YStack flex={1} gap={2}>
                <Text fontSize={13.5} fontWeight="600" color="$fg" numberOfLines={1}>
                  {a.title}
                </Text>
                <Text fontSize={11.5} color="$fgSubtle" numberOfLines={1}>
                  {a.date} · {a.category}
                </Text>
              </YStack>
              {a.pinned ? <Badge label="Penting" fg="$warning" bg="$warningSubtle" /> : null}
              <Feather name="chevron-right" size={15} color={tint("$fgSubtle")} />
            </Card>
          );
        })
      )}

      <Detail item={detail} open={open} onClose={() => setOpen(false)} />
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
