import { useCallback, useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import type { ImageResult } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image, ScrollView, Text, XStack, YStack, useTheme } from "tamagui";
import { type Bootstrap, type Office, get, postForm } from "@/api";
import { stopBackgroundPing } from "@/background-ping";
import { formatJarak, tanggalPanjang, jarakMeter } from "@/format";
import { canProcessImages, toWebp } from "@/image";
import { Peta } from "@/peta";
import { tint } from "@/theme";
import { toast } from "@/toast";
import {
  Btn,
  Card,
  ErrorNote,
  Group,
  Jam,
  Note,
  Row,
  Screen,
  SheetShell,
  Skeleton,
  SkeletonRows,
  Toggle,
  useTabBack,
} from "@/ui";

/**
 * Absen masuk / keluar (PRD-Mobile §6.1) — a screen, not a sheet.
 *
 * It was a bottom sheet, which meant a 28px selfie thumbnail, a two-column strip
 * of cramped status boxes, and no room to explain a failed GPS read. The punch is
 * the most consequential thing this app does and it is worth a whole screen: the
 * photo you are about to file is shown at the size you would want to check it,
 * and every state has somewhere to say what happened.
 *
 * The camera opens on arrival — the Beranda button says "absen masuk sekarang",
 * so the first thing that should happen is the thing you came to do. Location
 * resolves in parallel behind it.
 *
 * The selfie is mandatory for both punches, enforced by /api/me/clock before it
 * writes anything. Cancelling the camera therefore leaves the screen usable but the
 * button disabled, with the placeholder as the way back into it — a dead end would
 * be a punch that fails on submit after the employee thought they were done.
 */

type Fix = {
  lat: number;
  lng: number;
  label?: string;
  /** Android melaporkan sendiri fix yang berasal dari mock location provider,
   *  yaitu dari aplikasi fake-GPS. Server yang menolak punch-nya. */
  mocked?: boolean;
};

/** 3:4 portrait, 720px wide — enough for HR to recognise a face, small in R2. */
const SELFIE_RATIO = 3 / 4;
const SELFIE_WIDTH = 720;

export default function Absen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isFocused = useIsFocused();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
    enabled: isFocused,
  });

  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<ImageResult | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [wfh, setWfh] = useState(false);
  const [officeId, setOfficeId] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);

  const data = me.data;
  const clockedIn = Boolean(data?.today.clockIn && !data.today.clockOut);
  const action = clockedIn ? "out" : "in";

  /**
   * The GPS fix. Read once on arrival rather than on a timer — a fix costs
   * battery and the only moment it matters is the moment of the punch — but
   * retryable, which the sheet never was: a failed read there could only be
   * escaped by closing and reopening.
   */
  const readLocation = useCallback(async () => {
    setLocError(null);
    setFix(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocError("Izin lokasi ditolak. Absen butuh verifikasi lokasi.");
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const [place] = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }).catch(() => []);
      setFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        mocked: pos.mocked,
        label: place
          ? [place.street, place.district ?? place.city].filter(Boolean).join(", ")
          : undefined,
      });
    } catch {
      setLocError("Lokasi tidak terbaca. Pastikan GPS aktif lalu coba lagi.");
    }
  }, []);

  /**
   * Shutter, then 3:4 WebP.
   *
   * The camera hands back whatever its sensor shoots — 4:3, 16:9, 20 MP — so the
   * frame is centre-cropped to 3:4 here rather than through `allowsEditing`: the
   * system crop screen is another confirmation between the employee and a punch
   * they already tapped twice for, and nobody needs to compose a selfie.
   *
   * WebP at 0.6 lands a portrait around 60–90 KB where the JPEG this used to
   * upload was 400 KB+, and there is one selfie per punch per employee per day
   * sitting in R2 forever. Captured at quality 1 on purpose: compressing to JPEG
   * first and then to WebP throws detail away twice and saves nothing.
   *
   * WebP is the Android encoder's own format and this app ships Android only
   * (app.json `platforms`), so there is no fallback branch to carry. The server
   * validates the extension, hence the explicit `selfie.webp` on upload.
   */
  const takeSelfie = useCallback(async () => {
    // before the permission prompt, not after — asking for the camera only to
    // back out of it is worse than not asking
    if (!canProcessImages()) {
      // no longer a step that can be skipped, so say what it blocks
      toast("Foto wajib untuk absen · aplikasi perlu di-build ulang");
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return;
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      cameraType: ImagePicker.CameraType.front,
      quality: 1,
    });
    if (shot.canceled) return;

    setPreparing(true);
    try {
      setSelfie(await toWebp(shot.assets[0], { ratio: SELFIE_RATIO, width: SELFIE_WIDTH }));
    } catch {
      toast("Foto gagal diproses. Coba ambil ulang.");
    } finally {
      setPreparing(false);
    }
  }, []);

  /**
   * Which office this punch is measured against.
   *
   * On the way out there is nothing to choose: the server locks clock-out to the
   * office clock-in picked, so offering a list here would only invite somebody to
   * pick one and watch it be ignored.
   */
  const chosen =
    action === "out"
      ? data?.offices.find((o) => o.id === data.today.officeId)
      : data?.offices.find((o) => o.id === officeId);

  /**
   * Two-step preselection.
   *
   * The company's default office fills the row immediately, so the screen never
   * opens saying "Pilih kantor" when there is an obvious answer; the nearest one
   * takes over as soon as GPS reports, because on the ground proximity beats
   * whatever HR nominated. A manual pick outranks both — hence `picked`, which a
   * plain `officeId !== null` guard could not express once a default fills it in.
   */
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !data?.offices.length) return;
    if (!fix) {
      setOfficeId((prev) => prev ?? data.defaultOfficeId ?? null);
      return;
    }
    const near = data.offices.reduce((a, b) =>
      jarakMeter(fix.lat, fix.lng, a.lat, a.lng) <= jarakMeter(fix.lat, fix.lng, b.lat, b.lng)
        ? a
        : b,
    );
    setOfficeId(near.id);
    // `officeId` is a dependency so that clearing it on blur re-runs this and the
    // default lands again; both branches are idempotent, so there is no loop
  }, [fix, data, officeId]);

  const meter =
    fix && chosen ? jarakMeter(fix.lat, fix.lng, chosen.lat, chosen.lng) : null;
  /**
   * Clocking out of a day that was clocked in as WFH has no office to measure
   * against, and the server checks nothing — so neither does this. Without the
   * second clause the screen would demand the WFH switch again to end a day it
   * already knows was WFH.
   */
  const noGeofence = action === "out" && data?.today.officeId === null;
  const inside = noGeofence || (meter !== null && meter <= chosen!.radiusM);

  // kembali ke Beranda, bukan router.back() — lihat useTabBack di ui.tsx
  const close = useTabBack("/");

  const submit = useMutation({
    mutationFn: async () => {
      if (!fix) throw new Error("Lokasi belum siap");
      const form = new FormData();
      form.append("action", action);
      form.append("lat", String(fix.lat));
      form.append("lng", String(fix.lng));
      if (fix.label) form.append("location", fix.label);
      // Dikirim apa adanya dan ditolak di server, bukan dicegat di sini: penolakan
      // yang hanya hidup di telepon adalah penolakan yang bisa dihapus dari telepon,
      // dan percobaannya perlu tercatat di tempat yang tidak dipegang pelakunya.
      if (fix.mocked) form.append("mocked", "1");
      if (wfh) form.append("wfh", "1");
      // only on the way in — the server reads clock-out's office off the row and
      // ignores anything sent here
      else if (action === "in" && chosen) form.append("locationId", String(chosen.id));
      if (selfie) {
        // React Native's FormData takes {uri,name,type} for a file part; there is
        // no File to read the bytes into, and reading them would double memory
        form.append("selfie", {
          uri: selfie.uri,
          name: "selfie.webp",
          type: "image/webp",
        } as unknown as Blob);
      }
      return postForm<{ at: string; distanceM: number; location: string }>(
        "/api/me/clock",
        form,
      );
    },
    onSuccess: async (res) => {
      // Berhenti seketika, bukan menunggu ["me"] menyegarkan diri: persis pada detik
      // ini notifikasi "NanumHR mencatat lokasi" sedang dilihat orangnya.
      if (action === "out") await stopBackgroundPing();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["me"] }),
        qc.invalidateQueries({ queryKey: ["attendance"], refetchType: "none" }),
        qc.invalidateQueries({ queryKey: ["team"], refetchType: "none" }),
      ]);
      toast(
        action === "in"
          ? `Absen masuk tercatat ${res.at} · ${res.location}`
          : `Absen keluar tercatat ${res.at}`,
      );
      close();
    },
  });

  // bound once to the mutation observer, so it is a stable dependency below —
  // unlike `submit`, which is a fresh object every render
  const resetSubmit = submit.reset;

  /**
   * Arriving starts the punch; leaving throws away everything that was not sent.
   *
   * Both halves belong on focus rather than on mount, because this screen never
   * unmounts: `absen` is a Tabs.Screen with `href: null` (see (tabs)/_layout.tsx),
   * so going back only switches which route is focused and every useState survives.
   * That is why an abandoned punch used to be sitting there on the next visit —
   * yesterday's selfie, a stale GPS fix, and a WFH switch somebody had flipped —
   * ready to be submitted as if it had just been taken.
   *
   * Focus also expresses "open the camera once per visit" more honestly than the
   * ref the mount effect used to carry: the body runs once per focus, so cancelling
   * the camera does not reopen it, and coming back does.
   *
   * Nothing here fires on a successful punch beyond the same cleanup, which is what
   * we want — onSuccess navigates away, so the screen is left empty for next time.
   */
  useFocusEffect(
    useCallback(() => {
      void readLocation();
      void takeSelfie();
      return () => {
        setFix(null);
        setLocError(null);
        setSelfie(null);
        setPreparing(false);
        setWfh(false);
        setOfficeId(null);
        setPicker(false);
        picked.current = false;
        // clears the failure note too: a rejected punch must not greet the next visit
        resetSubmit();
      };
    }, [readLocation, takeSelfie, resetSubmit]),
  );

  /** the selfie counts here now: the server rejects a punch without one, so the
   *  button must not offer to send what cannot be accepted */
  const blocked = !fix || !selfie || (!inside && !wfh) || submit.isPending || preparing;

  // a cold deep link can land here before /api/me has answered — without this the
  // screen would flash "gagal memuat" at a request that is still in flight
  if (me.isPending) {
    return (
      <Screen paddingTop={insets.top + 40} paddingHorizontal={18}>
        <SkeletonRows count={2} lead={38} trail={false} />
      </Screen>
    );
  }
  if (me.isError || !data) {
    return (
      <Screen paddingHorizontal={18} paddingTop={insets.top + 40}>
        <ErrorNote
          message={(me.error as Error)?.message ?? "Gagal memuat data absensi"}
          onRetry={me.refetch}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Rata, bukan bergradien: Beranda dulu dibuka dengan indigo yang sama dan
          layar ini sengaja mengulangnya agar terasa "masuk lebih dalam" dari kartu
          itu. Beranda sekarang rata, jadi gradien di sini justru menjadi lompatan
          ke bahasa visual yang sudah tidak dipakai di mana pun lagi. */}
      <YStack
        backgroundColor="$bg"
        paddingTop={insets.top + 9}
        paddingHorizontal={18}
        paddingBottom={20}
      >
        <XStack alignItems="center" gap={10} marginBottom={16}>
          {/* bare chevron like every other back button — a translucent tile on a
              gradient was two backgrounds fighting for the same 36px */}
          <XStack
            width={40}
            height={40}
            marginLeft={-9}
            marginRight={-4}
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.5 }}
            onPress={close}
            accessibilityRole="button"
            aria-label="Kembali"
          >
            {/* nilai tema, bukan tint(): glyph telanjang di atas permukaan
                bertema — lihat Segmented dan PageHeader di ui.tsx */}
            <Feather name="chevron-left" size={25} color={theme.fg?.val} />
          </XStack>
          <Text fontSize={19} fontWeight="700" color="$fg">
            {action === "in" ? "Absen Masuk" : "Absen Keluar"}
          </Text>
        </XStack>

        <YStack alignItems="center" gap={2}>
          <Jam active={isFocused} fontFamily="$mono" fontSize={44} fontWeight="700" color="$fg" />
          <Text fontSize={12} color="$fgMuted">
            {tanggalPanjang(data.today.date)} · Shift {data.shift.start}–{data.shift.end}
          </Text>
        </YStack>
      </YStack>

      {/* the photo runs edge to edge, so the gutter belongs to the cards below it
          rather than to the scroll container */}
      <ScrollView contentContainerStyle={{ paddingBottom: 18, gap: 13 }}>
        <Selfie asset={selfie} preparing={preparing} onPress={takeSelfie} />

        <YStack paddingHorizontal={18} gap={13}>
        <LocationCard
          fix={fix}
          error={locError}
          inside={inside}
          meter={meter}
          office={chosen}
          onRetry={readLocation}
        />

        {/* the same verdict the card above states in words: the fence, and which
            side of it you are standing on */}
        {isFocused && fix ? (
          <Peta
            points={[
              { lat: fix.lat, lng: fix.lng, tone: "saya", label: "Posisi Anda" },
              ...(chosen
                ? [
                    {
                      lat: chosen.lat,
                      lng: chosen.lng,
                      tone: "kantor" as const,
                      label: chosen.name,
                    },
                  ]
                : []),
            ]}
            circles={
              chosen && !noGeofence
                ? [{ lat: chosen.lat, lng: chosen.lng, radiusM: chosen.radiusM }]
                : []
            }
          />
        ) : null}

        {/**
         * Which office, as a row rather than a segmented control: the list is
         * whatever HR created and a company with five branches would blow the pill
         * strip apart. Read-only on the way out, where the choice is already made.
         */}
        <Card padding={0} overflow="hidden">
          <Row
            icon="map-pin"
            label="Titik absen"
            value={
              chosen?.name ??
              (noGeofence ? "WFH" : data.offices.length ? "Pilih kantor" : "Belum ada")
            }
            note={
              action === "out"
                ? noGeofence
                  ? "Absen masuk hari ini ditandai WFH"
                  : "Mengikuti lokasi absen masuk"
                : data.offices.length > 1
                  ? `${data.offices.length} lokasi tersedia`
                  : undefined
            }
            chevron={action === "in" && data.offices.length > 1}
            onPress={
              action === "in" && data.offices.length > 1 ? () => setPicker(true) : undefined
            }
          />
        </Card>

        {/**
         * Not a ghost button on a pale panel — that read as a disabled control
         * sitting in a warning, and it is the one thing standing between the
         * employee and their punch. A switch says "this is a state you are
         * choosing", the explanation sits above it in warning tone, and the whole
         * thing is one card: reason on top, decision at the bottom.
         */}
        {fix && !inside ? (
          <Card padding={0} overflow="hidden" borderColor={wfh ? "$accentLine" : "$line"}>
            <XStack
              backgroundColor="$warningSubtle"
              paddingHorizontal={14}
              paddingVertical={12}
              gap={10}
            >
              <Feather name="alert-triangle" size={15} color={tint("$warning")} />
              <Text fontSize={12.5} color="$warning" lineHeight={18} flex={1}>
                {chosen
                  ? `Anda ${formatJarak(meter!)} dari ${chosen.name}, di luar radius ${chosen.radiusM} m. Absen dari luar kantor harus ditandai WFH.`
                  : "Belum ada titik absen aktif. Absen harus ditandai WFH."}
              </Text>
            </XStack>
            <Row
              icon="home"
              iconFg={wfh ? "$accent" : "$fgMuted"}
              iconBg={wfh ? "$accentSubtle" : "$inset"}
              label="Kerja dari rumah (WFH)"
              note={wfh ? "Kehadiran akan tercatat WFH" : "Aktifkan untuk melanjutkan"}
              noteTone={wfh ? "$accent" : "$fgSubtle"}
              onPress={() => setWfh((v) => !v)}
              right={
                <Toggle label="Kerja dari rumah" checked={wfh} onChange={setWfh} />
              }
            />
          </Card>
        ) : null}

        {submit.isError ? (
          <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
        ) : null}
        </YStack>
      </ScrollView>

      {/* the action stays in reach with the thumb, above the tab bar, and does not
          scroll away behind a long warning */}
      <YStack
        paddingHorizontal={18}
        paddingTop={13}
        paddingBottom={13}
        gap={9}
        backgroundColor="$surface"
        borderTopWidth={1}
        borderTopColor="$line"
      >
        <Btn height={50} disabled={blocked} onPress={() => submit.mutate()}>
          {submit.isPending
            ? "Mengirim…"
            : action === "in"
              ? "Konfirmasi absen masuk"
              : "Konfirmasi absen keluar"}
        </Btn>
        {/* one reason at a time, in the order they have to be resolved */}
        <Text fontSize={11} color="$fgSubtle" textAlign="center">
          {preparing
            ? "Menyiapkan foto…"
            : !selfie
              ? "Foto selfie wajib untuk absen"
              : !fix
                ? "Menunggu verifikasi lokasi"
                : !inside && !wfh
                  ? "Tandai WFH untuk melanjutkan dari luar radius"
                  : "Lokasi dan foto siap dikirim"}
        </Text>
      </YStack>

      <SheetShell open={picker} onClose={() => setPicker(false)} title="Pilih titik absen">
        <Group>
          {data.offices.map((o) => {
            const jarak = fix ? jarakMeter(fix.lat, fix.lng, o.lat, o.lng) : null;
            return (
              <Row
                key={o.id}
                icon="map-pin"
                iconFg={o.id === officeId ? "$accent" : "$fgMuted"}
                iconBg={o.id === officeId ? "$accentSubtle" : "$inset"}
                label={o.name}
                note={
                  jarak === null
                    ? `Radius ${o.radiusM} m`
                    : `${formatJarak(jarak)} dari sini · radius ${o.radiusM} m`
                }
                noteTone={jarak !== null && jarak <= o.radiusM ? "$success" : "$fgSubtle"}
                right={
                  o.id === officeId ? (
                    <Feather name="check" size={17} color={tint("$accent")} />
                  ) : undefined
                }
                onPress={() => {
                  picked.current = true;
                  setOfficeId(o.id);
                  setPicker(false);
                }}
              />
            );
          })}
        </Group>
      </SheetShell>
    </Screen>
  );
}

/**
 * The photo, at a size worth checking before it is filed. 4:3 rather than square
 * so a front camera's frame is not cropped to the chin, and the retake control
 * sits on the image instead of taking a row of its own.
 */
function Selfie({
  asset,
  preparing,
  onPress,
}: {
  asset: ImageResult | null;
  preparing: boolean;
  onPress: () => void;
}) {
  /**
   * Edge to edge, 3:4, no card around it — the photo *is* the top of this screen,
   * and a border plus a radius around a viewfinder only made it look like a
   * thumbnail that had escaped a list. One frame for all three states so nothing
   * shifts when a photo arrives.
   */
  const frame = { width: "100%", aspectRatio: SELFIE_RATIO } as const;

  if (preparing) {
    return (
      <YStack {...frame} backgroundColor="$inset" alignItems="center" justifyContent="center">
        <Text fontSize={12} color="$fgMuted">
          Menyiapkan foto…
        </Text>
      </YStack>
    );
  }

  if (!asset) {
    return (
      <YStack
        {...frame}
        backgroundColor="$inset"
        alignItems="center"
        justifyContent="center"
        gap={10}
        pressStyle={{ backgroundColor: "$lineStrong" }}
        onPress={onPress}
        accessibilityRole="button"
        aria-label="Ambil foto selfie"
      >
        <YStack
          width={56}
          height={56}
          borderRadius={28}
          backgroundColor="$surface"
          alignItems="center"
          justifyContent="center"
        >
          <Feather name="camera" size={24} color={tint("$accent")} />
        </YStack>
        <Text fontSize={14} fontWeight="600" color="$fg">
          Ambil foto selfie
        </Text>
        <Text fontSize={11.5} color="$danger">
          Wajib · bukti kehadiran
        </Text>
      </YStack>
    );
  }

  return (
    <YStack {...frame} backgroundColor="$inset">
      <Image
        source={{ uri: asset.uri }}
        width="100%"
        height="100%"
        resizeMode="cover"
        accessibilityLabel="Foto selfie absen"
      />
      <XStack
        position="absolute"
        bottom={14}
        alignSelf="center"
        backgroundColor="rgba(20,22,27,.62)"
        borderRadius={20}
        paddingHorizontal={15}
        paddingVertical={9}
        alignItems="center"
        gap={7}
        pressStyle={{ backgroundColor: "rgba(20,22,27,.8)" }}
        onPress={onPress}
        accessibilityRole="button"
        aria-label="Ambil ulang foto"
      >
        <Feather name="refresh-cw" size={13} color="#fff" />
        <Text fontSize={12.5} fontWeight="600" color="#fff">
          Ulangi
        </Text>
      </XStack>
    </YStack>
  );
}

/** Where the punch will be recorded, and why it is or is not accepted. */
function LocationCard({
  fix,
  error,
  inside,
  meter,
  office,
  onRetry,
}: {
  fix: Fix | null;
  error: string | null;
  inside: boolean;
  meter: number | null;
  /** undefined while no office is picked yet, or when HR has none active */
  office: Office | undefined;
  onRetry: () => void;
}) {
  const tone = error
    ? { fg: "$danger", bg: "$dangerSubtle", icon: "alert-circle" as const, label: "Lokasi gagal" }
    : !fix
      ? { fg: "$fgMuted", bg: "$inset", icon: "crosshair" as const, label: "Membaca lokasi…" }
      : inside
        ? { fg: "$success", bg: "$successSubtle", icon: "check" as const, label: "Lokasi cocok" }
        : { fg: "$warning", bg: "$warningSubtle", icon: "map-pin" as const, label: "Di luar radius" };

  return (
    <Card paddingHorizontal={14} paddingVertical={13} flexDirection="row" gap={12}>
      <YStack
        width={38}
        height={38}
        borderRadius={12}
        backgroundColor={tone.bg}
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <Feather name={tone.icon} size={18} color={tint(tone.fg)} />
      </YStack>

      <YStack flex={1} gap={4} justifyContent="center">
        <Text fontSize={13.5} fontWeight="600" color={tone.fg}>
          {tone.label}
        </Text>
        {!fix && !error ? (
          <Skeleton height={9} width="72%" />
        ) : (
          <Text fontSize={11.5} color="$fgMuted" lineHeight={17}>
            {error ??
              (office
                ? `${fix?.label ?? office.name} · ${formatJarak(meter ?? 0)} dari ${office.name} · radius ${office.radiusM} m`
                : (fix?.label ?? "Tidak ada titik absen aktif"))}
          </Text>
        )}
      </YStack>

      {/**
       * A plain pressable, not a <Btn>: a Button applies its own horizontal padding
       * from its size token, so a 34px-wide one clips the glyph inside it to
       * nothing — which is exactly how the download button in Berkas ended up an
       * empty box. $fgSubtle over $fgMuted because tint() hands back the
       * light-theme value, and #59606d falls to 2.75:1 on a dark card.
       */}
      {error ? (
        <XStack
          width={36}
          height={36}
          borderRadius={10}
          borderWidth={1}
          borderColor="$fgMuted"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
          pressStyle={{ backgroundColor: "$inset" }}
          onPress={onRetry}
          accessibilityRole="button"
          aria-label="Coba lagi baca lokasi"
        >
          <Feather name="refresh-cw" size={15} color={tint("$fgSubtle")} />
        </XStack>
      ) : null}
    </Card>
  );
}
