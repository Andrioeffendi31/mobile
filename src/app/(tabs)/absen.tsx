import { useCallback, useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import type { ImageResult } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "@tamagui/linear-gradient";
import { Image, ScrollView, Text, XStack, YStack } from "tamagui";
import { type Bootstrap, get, postForm } from "@/api";
import { formatJarak, jamWib, tanggalPanjang, jarakMeter } from "@/format";
import { canProcessImages, toWebp } from "@/image";
import { HEADER_GRADIENT, tint } from "@/theme";
import { toast } from "@/toast";
import {
  Btn,
  Card,
  ErrorNote,
  Mono,
  Note,
  Row,
  Screen,
  Skeleton,
  SkeletonRows,
  Toggle,
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

type Fix = { lat: number; lng: number; label?: string };

/** 3:4 portrait, 720px wide — enough for HR to recognise a face, small in R2. */
const SELFIE_RATIO = 3 / 4;
const SELFIE_WIDTH = 720;

export default function Absen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Bootstrap>("/api/me") });

  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<ImageResult | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [wfh, setWfh] = useState(false);
  const [clock, setClock] = useState(jamWib(true));

  const data = me.data;
  const clockedIn = Boolean(data?.today.clockIn && !data.today.clockOut);
  const action = clockedIn ? "out" : "in";

  useEffect(() => {
    const t = setInterval(() => setClock(jamWib(true)), 1000);
    return () => clearInterval(t);
  }, []);

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

  // once per visit, not once per render: re-opening the camera after somebody
  // deliberately cancelled it would trap them on this screen
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void readLocation();
    void takeSelfie();
  }, [readLocation, takeSelfie]);

  const meter =
    fix && data ? jarakMeter(fix.lat, fix.lng, data.office.lat, data.office.lng) : null;
  const inside = meter !== null && data !== undefined && meter <= data.office.radiusM;

  const submit = useMutation({
    mutationFn: async () => {
      if (!fix) throw new Error("Lokasi belum siap");
      const form = new FormData();
      form.append("action", action);
      form.append("lat", String(fix.lat));
      form.append("lng", String(fix.lng));
      if (fix.label) form.append("location", fix.label);
      if (wfh) form.append("wfh", "1");
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
      await qc.invalidateQueries();
      toast(
        action === "in"
          ? `Absen masuk tercatat ${res.at} · ${res.location}`
          : `Absen keluar tercatat ${res.at}`,
      );
      if (router.canGoBack()) router.back();
      else router.replace("/");
    },
  });

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
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
      {/* the same indigo the Beranda opens with, so arriving here reads as going
          deeper into that card rather than landing somewhere else */}
      <LinearGradient
        colors={[...HEADER_GRADIENT]}
        start={[0, 0]}
        end={[0.6, 1]}
        paddingTop={insets.top + 9}
        paddingHorizontal={18}
        paddingBottom={26}
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
            <Feather name="chevron-left" size={25} color="#fff" />
          </XStack>
          <Text fontSize={19} fontWeight="700" color="#fff">
            {action === "in" ? "Absen Masuk" : "Absen Keluar"}
          </Text>
        </XStack>

        <YStack alignItems="center" gap={2}>
          <Mono fontSize={44} fontWeight="700" color="#fff">
            {clock}
          </Mono>
          <Text fontSize={12} color="#fff" opacity={0.85}>
            {tanggalPanjang(data.today.date)} · Shift {data.shift.start}–{data.shift.end}
          </Text>
        </YStack>
      </LinearGradient>

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
          office={data.office}
          onRetry={readLocation}
        />

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
                Anda {formatJarak(meter!)} dari kantor, di luar radius{" "}
                {data.office.radiusM} m. Absen dari luar kantor harus ditandai WFH.
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
  office: Bootstrap["office"];
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
              `${fix?.label ?? office.label} · ${formatJarak(meter ?? 0)} dari titik absen · radius ${office.radiusM} m`}
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
