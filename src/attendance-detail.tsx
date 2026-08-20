import { useState } from "react";
import { Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image, Text, XStack, YStack } from "tamagui";
import { API, type AttendanceDay, get, useSession } from "@/api";
import { durasiJam, formatJarak, tanggalPanjang } from "@/format";
import { Peta, type Titik } from "@/peta";
import { tint } from "@/theme";
import { AttBadge, Mono, Note, SheetShell, Skeleton, useAndroidBack } from "@/ui";

/**
 * One day of attendance, opened from a card in Kehadiran.
 *
 * The card already says the date, the hours and the status, so this is not a
 * bigger card: it is the two things the list cannot hold. The selfie filed with
 * the punch, and the event trail — including the periodic location pings this app
 * writes while somebody is clocked in. An employee whose movements are recorded by
 * their employer should be able to read that record without asking HR to open
 * their console.
 */

const KIND: Record<
  AttendanceDay["events"][number]["kind"],
  { label: string; icon: React.ComponentProps<typeof Feather>["name"]; fg: string; bg: string }
> = {
  masuk: { label: "Absen masuk", icon: "log-in", fg: "$success", bg: "$successSubtle" },
  keluar: { label: "Absen keluar", icon: "log-out", fg: "$info", bg: "$infoSubtle" },
  catatan: { label: "Catatan", icon: "edit-3", fg: "$warning", bg: "$warningSubtle" },
  // dimmer than the two manual punches: an automatic ping is context, not an act
  lokasi: { label: "Ping lokasi", icon: "map-pin", fg: "$fgMuted", bg: "$inset" },
};

export function AttendanceDetailSheet({
  date,
  open,
  onClose,
}: {
  /** null while nothing is selected — the query only runs for a real date */
  date: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["attendance-day", date],
    queryFn: ({ signal }) => get<AttendanceDay>(`/api/me/attendance/${date}`, { signal }),
    enabled: open && date !== null,
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={date ? tanggalPanjang(date) : ""}
    >
      {q.isPending ? (
        <YStack gap={11}>
          <Skeleton height={11} width="46%" />
          <Skeleton height={64} radius={12} />
          <Skeleton height={11} width="62%" />
          <Skeleton height={44} radius={12} />
        </YStack>
      ) : q.isError ? (
        <Note text={(q.error as Error).message} fg="$danger" bg="$dangerSubtle" />
      ) : q.data ? (
        <Day day={q.data} />
      ) : null}
    </SheetShell>
  );
}

/** Section heading for a reading view — Field's label is sized for a form row. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <YStack gap={10}>
      <Text fontSize={16} lineHeight={21} fontWeight="700" color="$fg">
        {label}
      </Text>
      {children}
    </YStack>
  );
}

function Day({ day }: { day: AttendanceDay }) {
  /**
   * Selfies are streamed by /api/files, not handed out as a signed URL: that route
   * only presigns keys it has a filename for (documents, attachments), and a
   * `selfie/…` key falls through to the proxy. So the session travels as a header
   * on the image request itself — RN's Image supports that, and it means no URL
   * that expires 60 seconds after the sheet opened.
   */
  const cookie = useSession((st) => st.cookie);
  const photo = (key: string) => ({
    uri: `${API}/api/files/${key}`,
    ...(cookie ? { headers: { cookie } } : {}),
  });
  const [preview, setPreview] = useState<string | null>(null);

  /**
   * The events as map dots, in order. A ping beyond the fence gets the warning
   * colour — that judgement is already made for us by the server, which sends the
   * distance measured against the office this day was actually punched at.
   */
  const titik: Titik[] = day.events.flatMap((e) =>
    e.lat === null || e.lng === null
      ? []
      : [
          {
            lat: e.lat,
            lng: e.lng,
            label: `${KIND[e.kind].label} ${e.at}`,
            tone:
              e.kind === "masuk"
                ? ("masuk" as const)
                : e.kind === "keluar"
                  ? ("keluar" as const)
                  : day.officeGeo && e.distanceM !== null && e.distanceM > day.officeGeo.radiusM
                    ? ("peringatan" as const)
                    : ("ping" as const),
          },
        ],
  );

  return (
    <>
      <YStack
        backgroundColor="$surface2"
        borderRadius={24}
        padding={16}
        gap={15}
        overflow="hidden"
      >
        <YStack
          position="absolute"
          width={112}
          height={112}
          borderRadius={56}
          backgroundColor="$accentSubtle"
          right={-34}
          top={-48}
          opacity={0.7}
          pointerEvents="none"
        />
        <XStack alignItems="center" justifyContent="space-between" gap={12}>
          <YStack gap={4}>
            <Text fontSize={11.5} fontWeight="500" color="$fgMuted">
              Status kehadiran
            </Text>
            <AttBadge status={day.status} />
          </YStack>
          <XStack
            alignItems="center"
            gap={7}
            backgroundColor="$inset"
            borderRadius={14}
            paddingHorizontal={11}
            paddingVertical={8}
          >
            <Feather name="clock" size={14} color={tint("$fgMuted")} />
            <Text fontSize={11.5} fontWeight="600" color="$fgMuted">
              {day.shift.start}–{day.shift.end}
            </Text>
          </XStack>
        </XStack>

        <XStack gap={9}>
          <Clock label="Absen masuk" value={day.in} icon="log-in" />
          <Clock label="Absen keluar" value={day.out} icon="log-out" />
        </XStack>
      </YStack>

      {/* Kalau hari ini tercatat tanpa keterangan padahal Anda sudah mengajukan izin,
          alasan penolakannya ada di sini, bukan hanya di riwayat pengajuan. */}
      {day.ditolak ? (
        <Note
          fg="$warning"
          bg="$warningSubtle"
          text={`Pengajuan ${day.ditolak.type.toLowerCase()} (${day.ditolak.startDate} s/d ${day.ditolak.endDate}) ditolak.${day.ditolak.note ? ` ${day.ditolak.note}` : ""}`}
        />
      ) : null}

      <YStack
        backgroundColor="$surface2"
        borderRadius={22}
        paddingHorizontal={15}
        overflow="hidden"
      >
        {day.location ? (
          <InfoRow icon="map-pin" label="Lokasi tercatat" value={day.location} />
        ) : null}
        {/* which geofence the day was judged against — the trail's distances below
            are measured from this point, not from wherever is nearest today */}
        <InfoRow
          icon="navigation"
          label="Titik absen"
          value={day.office ?? "Tanpa titik kantor (WFH)"}
          divider={Boolean(day.location)}
        />
      </YStack>
      {day.note ? <Note text={day.note} fg="$fgMuted" bg="$inset" /> : null}

      {/* Alasan yang Anda tulis sendiri, dan apa yang admin putuskan atasnya —
          supaya tidak perlu bertanya apakah penjelasannya sampai atau tidak. */}
      {day.lateReason || day.earlyReason ? (
        <Note
          fg={day.review === null ? "$fgMuted" : day.review.ok ? "$success" : "$danger"}
          bg={
            day.review === null
              ? "$inset"
              : day.review.ok
                ? "$successSubtle"
                : "$dangerSubtle"
          }
          text={[
            day.lateReason ? `Alasan terlambat: ${day.lateReason}` : null,
            day.earlyReason ? `Alasan pulang cepat: ${day.earlyReason}` : null,
            day.review === null
              ? "Menunggu tinjauan admin."
              : day.review.ok
                ? "Diterima admin, hari ini tercatat hadir."
                : "Ditolak admin.",
            day.review?.note,
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ) : null}

      {/* the trail the list below spells out, as one picture — the ping that fell
          outside the fence is the thing you are looking for, and it is easier to
          spot on a map than in twelve rows of "1,2 km dari kantor" */}
      {titik.length > 0 ? (
        <Peta
          trail
          points={
            day.officeGeo
              ? [
                  {
                    ...day.officeGeo,
                    tone: "kantor" as const,
                    label: day.office ?? "Kantor",
                  },
                  ...titik,
                ]
              : titik
          }
          circles={day.officeGeo ? [day.officeGeo] : []}
        />
      ) : null}

      {day.selfieKey ? (
        <Section label="Foto absen">
          <YStack
            width="100%"
            aspectRatio={4 / 3}
            borderRadius={22}
            overflow="hidden"
            backgroundColor="$inset"
            pressStyle={{ opacity: 0.85 }}
            onPress={() => setPreview(day.selfieKey)}
            accessibilityRole="button"
            aria-label="Buka foto absen layar penuh"
          >
            <Image
              source={photo(day.selfieKey)}
              width="100%"
              height="100%"
              resizeMode="cover"
              accessibilityLabel="Foto absen hari ini"
            />
            <XStack
              position="absolute"
              right={12}
              bottom={12}
              width={38}
              height={38}
              borderRadius={15}
              alignItems="center"
              justifyContent="center"
              backgroundColor="rgba(20,22,27,.62)"
            >
              <Feather name="maximize-2" size={16} color="#fff" />
            </XStack>
          </YStack>
        </Section>
      ) : null}

      <Section label={`Riwayat hari ini (${day.events.length})`}>
        {day.events.length === 0 ? (
          <Text fontSize={13} color="$fgSubtle">
            Tidak ada kejadian tercatat.
          </Text>
        ) : (
          <YStack
            backgroundColor="$surface2"
            borderRadius={22}
            paddingHorizontal={14}
            paddingTop={14}
            paddingBottom={14}
          >
            {day.events.map((e, i) => {
              const kind = KIND[e.kind];
              const last = i === day.events.length - 1;
              return (
                <XStack key={e.id} gap={11}>
                  {/* a rail rather than a divider per row: the times are a sequence,
                      and the line is what says so */}
                  <YStack alignItems="center" width={34}>
                    <YStack
                      width={34}
                      height={34}
                      borderRadius={17}
                      backgroundColor={kind.bg}
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Feather name={kind.icon} size={16} color={tint(kind.fg)} />
                    </YStack>
                    {last ? null : <YStack flex={1} width={1.5} backgroundColor="$line" />}
                  </YStack>

                  <YStack flex={1} paddingBottom={last ? 0 : 14} gap={2}>
                    <XStack alignItems="center" gap={8}>
                      <Text fontSize={14} fontWeight="600" color="$fg" flex={1}>
                        {kind.label}
                      </Text>
                      <Mono fontSize={14} fontWeight="600">
                        {e.at}
                      </Mono>
                    </XStack>
                    {e.location ? (
                      <Text fontSize={12.5} color="$fgMuted" lineHeight={18}>
                        {e.location}
                      </Text>
                    ) : null}
                    <XStack alignItems="center" gap={9} flexWrap="wrap">
                      {e.distanceM !== null ? (
                        <Text fontSize={12} color="$fgSubtle">
                          {formatJarak(e.distanceM)} dari kantor
                        </Text>
                      ) : null}
                      {/* a thumbnail, not a "lihat foto" link — and it opens the
                          full frame, because 56px settles which moment it was but
                          not who is in it */}
                      {e.photoKey ? (
                        <YStack
                          width={56}
                          height={56}
                          borderRadius={10}
                          overflow="hidden"
                          backgroundColor="$inset"
                          pressStyle={{ opacity: 0.7 }}
                          onPress={() => setPreview(e.photoKey)}
                          accessibilityRole="button"
                          aria-label={`Buka foto ${kind.label} layar penuh`}
                        >
                          <Image
                            source={photo(e.photoKey)}
                            width="100%"
                            height="100%"
                            resizeMode="cover"
                          />
                        </YStack>
                      ) : null}
                    </XStack>
                    {e.note ? (
                      <Text fontSize={12.5} color="$fgSubtle" lineHeight={18}>
                        {e.note}
                      </Text>
                    ) : null}
                    {/* Karyawan melihat tandanya juga, bukan cuma HR: catatan yang
                        menuduh seseorang tanpa ia pernah tahu bukan catatan yang
                        bisa ia bantah. */}
                    {e.suspect ? (
                      <Text fontSize={12.5} color="$danger" fontWeight="500" lineHeight={18}>
                        {e.suspect}
                      </Text>
                    ) : null}
                    {/* Lubang pada jejak, dijelaskan kepada orangnya sendiri — ia yang
                        paling tahu apakah ponselnya memang mati siang itu. */}
                    {e.jedaSesudah ? (
                      <YStack
                        marginTop={4}
                        backgroundColor="$warningSubtle"
                        borderRadius={10}
                        paddingHorizontal={11}
                        paddingVertical={9}
                        gap={2}
                      >
                        <Text fontSize={12.5} fontWeight="600" color="$warning">
                          Tidak ada catatan selama {durasiJam(e.jedaSesudah.menit)}
                        </Text>
                        <Text fontSize={11.5} color="$fgMuted" lineHeight={17}>
                          {e.jedaSesudah.tertunda
                            ? "Ponsel tanpa jaringan — titik sesudahnya terkirim menyusul."
                            : "Aplikasi kemungkinan ditutup, ponsel mati, atau dihentikan penghemat baterai."}
                        </Text>
                      </YStack>
                    ) : null}
                  </YStack>
                </XStack>
              );
            })}
          </YStack>
        )}
      </Section>

      <PhotoPreview
        source={preview ? photo(preview) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

/**
 * Full-screen photo, over everything.
 *
 * React Native's own Modal rather than another Sheet or an absolutely positioned
 * overlay: this is opened from inside a sheet, and an overlay would be clipped to
 * that sheet's frame while a second portal would be stacking two of Tamagui's on
 * top of each other. Modal also gives the Android back button its expected meaning
 * for free.
 */
function PhotoPreview({
  source,
  onClose,
}: {
  source: { uri: string; headers?: Record<string, string> } | null;
  onClose: () => void;
}) {
  /**
   * Belt and braces with `onRequestClose`. The native dialog is documented to call
   * that on back, and it very likely consumes the key event too — but if it ever
   * forwards it instead, the sheet underneath would hear the same press and both
   * would close at once. Registered after the sheet's own handler, so this one is
   * asked first either way, and exactly one thing closes.
   */
  useAndroidBack(source !== null, onClose);

  return (
    <Modal
      visible={source !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <YStack
        flex={1}
        backgroundColor="rgba(0,0,0,.94)"
        alignItems="center"
        justifyContent="center"
        onPress={onClose}
        accessibilityRole="button"
        aria-label="Tutup foto"
      >
        {source ? (
          <Image
            source={source}
            width="100%"
            height="100%"
            // contain, not cover: a selfie filed as evidence must not be cropped by
            // the screen it is being checked on
            resizeMode="contain"
            accessibilityLabel="Foto absen ukuran penuh"
          />
        ) : null}
        <XStack
          position="absolute"
          top={54}
          right={18}
          width={40}
          height={40}
          borderRadius={20}
          backgroundColor="rgba(255,255,255,.16)"
          alignItems="center"
          justifyContent="center"
          pressStyle={{ backgroundColor: "rgba(255,255,255,.3)" }}
          onPress={onClose}
          accessibilityRole="button"
          aria-label="Tutup foto"
        >
          <Feather name="x" size={20} color="#fff" />
        </XStack>
      </YStack>
    </Modal>
  );
}

function InfoRow({
  icon,
  label,
  value,
  divider = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <XStack
      minHeight={66}
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderTopWidth={divider ? 1 : 0}
      borderTopColor="$line"
    >
      <YStack
        width={38}
        height={38}
        borderRadius={14}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$inset"
      >
        <Feather name={icon} size={16} color={tint("$fgMuted")} />
      </YStack>
      <YStack flex={1} gap={2}>
        <Text fontSize={10.5} fontWeight="500" color="$fgSubtle">
          {label}
        </Text>
        <Text fontSize={12.5} lineHeight={18} fontWeight="500" color="$fg">
          {value}
        </Text>
      </YStack>
    </XStack>
  );
}

function Clock({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <YStack flex={1} backgroundColor="$surface" borderRadius={18} padding={13} gap={8}>
      <XStack alignItems="center" gap={7}>
        <Feather name={icon} size={14} color={tint("$accent")} />
        <Text fontSize={11} color="$fgSubtle">
          {label}
        </Text>
      </XStack>
      <Mono fontSize={21} lineHeight={26} fontWeight="700">
        {value || "—"}
      </Mono>
    </YStack>
  );
}
