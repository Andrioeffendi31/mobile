import { useEffect, useState } from "react";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image, Sheet, Spinner, Text, XStack, YStack } from "tamagui";
import { type Bootstrap, postForm } from "@/api";
import { formatJarak, jamWib, jarakMeter } from "@/format";
import { Btn, Mono, Note } from "@/ui";

/**
 * The clock in/out sheet (PRD-Mobile §6.1).
 *
 * Location is fetched when the sheet opens, not on a timer: a GPS fix costs
 * battery, and the only moment the reading matters is the moment of the punch.
 * The distance shown here is advisory — /api/me/clock re-measures against the
 * office point in the settings table and rejects the punch itself, so a patched
 * app cannot clock in from home by lying about its coordinates.
 */

type Fix = { lat: number; lng: number; label?: string };

export function ClockSheet({
  open,
  onClose,
  me,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  me: Bootstrap;
  onDone: (message: string) => void;
}) {
  const clockedIn = Boolean(me.today.clockIn && !me.today.clockOut);
  const action = clockedIn ? "out" : "in";
  const qc = useQueryClient();

  const [fix, setFix] = useState<Fix | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [wfh, setWfh] = useState(false);

  // reset per opening: a stale fix from an hour ago would be shown as if it were
  // current, and a selfie from the morning must not be reused at clock-out
  useEffect(() => {
    if (!open) return;
    setFix(null);
    setLocError(null);
    setSelfie(null);
    setWfh(false);

    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setLocError("Izin lokasi ditolak. Absen butuh verifikasi lokasi.");
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const [place] = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }).catch(() => []);
        if (cancelled) return;
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: place ? [place.street, place.district ?? place.city].filter(Boolean).join(", ") : undefined,
        });
      } catch {
        if (!cancelled) setLocError("Lokasi tidak terbaca. Pastikan GPS aktif lalu coba lagi.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const meter = fix
    ? jarakMeter(fix.lat, fix.lng, me.office.lat, me.office.lng)
    : null;
  const inside = meter !== null && meter <= me.office.radiusM;

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
          name: selfie.fileName ?? "selfie.jpg",
          type: selfie.mimeType ?? "image/jpeg",
        } as unknown as Blob);
      }
      return postForm<{ at: string; distanceM: number; location: string }>(
        "/api/me/clock",
        form,
      );
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries();
      onClose();
      onDone(
        action === "in"
          ? `Absen masuk tercatat ${res.at} · ${res.location}`
          : `Absen keluar tercatat ${res.at}`,
      );
    },
  });

  async function takeSelfie() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      cameraType: ImagePicker.CameraType.front,
      // 0.4 keeps a phone photo under the server's 4 MB image ceiling without a
      // resize step (and therefore without expo-image-manipulator)
      quality: 0.4,
    });
    if (!result.canceled) setSelfie(result.assets[0]);
  }

  const blocked = !fix || (!inside && !wfh) || submit.isPending;

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => !next && onClose()}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      transition="medium"
    >
      <Sheet.Overlay backgroundColor="rgba(20,22,27,.42)" />
      <Sheet.Handle />
      <Sheet.Frame
        backgroundColor="$surface"
        borderTopLeftRadius={22}
        borderTopRightRadius={22}
        paddingHorizontal={22}
        paddingTop={12}
        paddingBottom={30}
        gap={14}
      >
        <YStack gap={4}>
          <Text fontSize={18} fontWeight="700" color="$fg">
            {action === "in" ? "Absen Masuk" : "Absen Keluar"}
          </Text>
          <Text fontSize={12.5} color="$fgMuted">
            Verifikasi lokasi diperlukan sesuai kebijakan absensi. Foto selfie opsional.
          </Text>
        </YStack>

        <XStack gap={10}>
          <YStack
            flex={1}
            borderRadius={12}
            padding={12}
            gap={4}
            backgroundColor={
              locError ? "$dangerSubtle" : inside ? "$successSubtle" : fix ? "$warningSubtle" : "$inset"
            }
          >
            <XStack alignItems="center" gap={6}>
              {!fix && !locError ? <Spinner size="small" color="$fgMuted" /> : (
                <Feather
                  name={locError ? "alert-circle" : inside ? "check" : "map-pin"}
                  size={13}
                  color={locError ? "#c0392b" : inside ? "#0f7b5a" : "#b4530b"}
                />
              )}
              <Text
                fontSize={11.5}
                fontWeight="600"
                color={locError ? "$danger" : inside ? "$success" : fix ? "$warning" : "$fgMuted"}
              >
                {locError
                  ? "Lokasi gagal"
                  : !fix
                    ? "Membaca lokasi…"
                    : inside
                      ? "Lokasi cocok"
                      : "Di luar radius"}
              </Text>
            </XStack>
            <Text fontSize={11.5} color="$fgMuted" lineHeight={16}>
              {locError ??
                (meter === null
                  ? "Menunggu sinyal GPS"
                  : `${me.office.label} · ${formatJarak(meter)} dari titik absen`)}
            </Text>
          </YStack>

          <YStack flex={1} backgroundColor="$inset" borderRadius={12} padding={12} gap={6}>
            <Text fontSize={11.5} fontWeight="600" color="$fgMuted">
              Foto selfie
            </Text>
            {selfie ? (
              <XStack alignItems="center" gap={8}>
                <Image
                  source={{ uri: selfie.uri, width: 28, height: 28 }}
                  width={28}
                  height={28}
                  borderRadius={8}
                />
                <Btn small tone="ghost" onPress={takeSelfie} flex={1}>
                  Ulangi
                </Btn>
              </XStack>
            ) : (
              <Btn small tone="ghost" onPress={takeSelfie}>
                Ambil foto
              </Btn>
            )}
          </YStack>
        </XStack>

        {fix && !inside ? (
          <YStack gap={8}>
            <Note
              text={`Anda ${formatJarak(meter!)} dari kantor, di luar radius ${me.office.radiusM} m. Tandai sebagai WFH bila memang bekerja dari luar kantor — status kehadiran akan tercatat WFH.`}
              fg="$warning"
              bg="$warningSubtle"
            />
            <Btn
              small
              tone={wfh ? undefined : "ghost"}
              onPress={() => setWfh((v) => !v)}
            >
              {wfh ? "Ditandai WFH ✓" : "Tandai sebagai WFH"}
            </Btn>
          </YStack>
        ) : null}

        <XStack
          backgroundColor="$surface2"
          borderWidth={1}
          borderColor="$line"
          borderRadius={12}
          paddingHorizontal={13}
          paddingVertical={12}
          alignItems="center"
          justifyContent="space-between"
        >
          <Text fontSize={12.5} color="$fgMuted">
            Waktu absen
          </Text>
          <Mono fontSize={14} fontWeight="600">
            {jamWib()} WIB
          </Mono>
        </XStack>

        {submit.isError ? (
          <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
        ) : null}

        <XStack gap={10}>
          <Btn tone="ghost" width={46} onPress={onClose} aria-label="Tutup">
            <Feather name="x" size={17} color="#59606d" />
          </Btn>
          <Btn flex={1} disabled={blocked} onPress={() => submit.mutate()}>
            {submit.isPending
              ? "Mengirim…"
              : action === "in"
                ? "Konfirmasi absen masuk"
                : "Konfirmasi absen keluar"}
          </Btn>
        </XStack>
      </Sheet.Frame>
    </Sheet>
  );
}
