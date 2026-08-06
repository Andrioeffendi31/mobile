import { useState } from "react";
import { Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, YStack } from "tamagui";
import { type Bootstrap, get, logout, postForm } from "@/api";
import { canPingInBackground } from "@/background-ping";
import { canProcessImages, toWebp } from "@/image";
import { available as passkeyAvailable, enrollPasskey } from "@/passkey";
import { registerForPush, unregisterFromPush, usePushStatus } from "@/push";
import { usePrefs } from "@/prefs";
import { toast } from "@/toast";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  ErrorNote,
  Group,
  GroupLabel,
  Mono,
  PageHeader,
  Row,
  Screen,
  Segmented,
  SkeletonRows,
  Toggle,
} from "@/ui";

/**
 * Pengaturan (the mockup's `isSettings` view) — the fifth tab, in place of the
 * old "Info & Berkas". Announcements belong on the Beranda, where an employee
 * already looks every morning; berkas and tentang are sub-pages of this screen;
 * what is left is one screen about the account and the app rather than a tab
 * that mixed the two.
 *
 * Every row here is backed by something that already exists — a stored
 * preference, an OS permission, a passkey endpoint, the query cache. Nothing is
 * a placeholder toggle: a setting that does not take effect is worse than a
 * setting that is missing.
 */
export default function Pengaturan() {
  const router = useRouter();
  const avatar = useAvatarUpload();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Bootstrap>("/api/me") });

  // the trail is started by the Beranda when the day starts; this reads the
  // permission back so "HR cannot see my location" has an answer in the app
  const trail = useQuery({ queryKey: ["bg-location"], queryFn: canPingInBackground });

  const keluar = () =>
    Alert.alert("Keluar dari akun?", "Anda perlu masuk lagi untuk mencatat absensi.", [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluar",
        style: "destructive",
        // clear the cache too: the next person to sign in on this phone must not
        // see the previous employee's cached leave balance for a frame
        onPress: async () => {
          await unregisterFromPush();
          await logout();
          qc.clear();
        },
      },
    ]);

  return (
    <Screen>
      {/* a tab root, so no back button — the tab bar is the way out */}
      <PageHeader title="Pengaturan" subtitle="Akun, berkas, keamanan dan preferensi" />

      <ScrollView
        // the tab bar already carries the bottom inset, like every other screen
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 19 }}
      >
        {me.isPending ? (
          // the identity card: avatar, name, NIK, status chip
          <SkeletonRows count={1} lead={42} />
        ) : me.isError ? (
          <ErrorNote message={(me.error as Error).message} onRetry={me.refetch} />
        ) : (
          <Card padding={14} flexDirection="row" alignItems="center" gap={12} elevation={1}>
            <YStack
              pressStyle={{ opacity: 0.7 }}
              onPress={avatar.choose}
              accessibilityRole="button"
              aria-label="Ganti foto profil"
            >
              <Avatar
                seed={me.data.profile.id}
                initials={me.data.profile.initials}
                photoKey={me.data.profile.photoKey}
                size={46}
                borderRadius={13}
                opacity={avatar.busy ? 0.5 : 1}
              />
              {/* a badge, because a tappable avatar with nothing on it is a secret */}
              <YStack
                position="absolute"
                right={-3}
                bottom={-3}
                width={20}
                height={20}
                borderRadius={10}
                backgroundColor="$accent"
                borderWidth={2}
                borderColor="$surface"
                alignItems="center"
                justifyContent="center"
              >
                <Feather name="camera" size={9} color="#fff" />
              </YStack>
            </YStack>
            <YStack flex={1}>
              <Text fontSize={14} fontWeight="600" color="$fg" numberOfLines={1}>
                {me.data.profile.name}
              </Text>
              <Mono fontSize={11.5} color="$fgSubtle" numberOfLines={1}>
                {me.data.profile.nik} · {me.data.profile.division}
              </Mono>
            </YStack>
            <Badge label="Aktif" fg="$success" bg="$successSubtle" />
          </Card>
        )}

        {/* first group under the identity card: the only content destination on
            this screen, and the one an employee actually comes looking for */}
        <Group label="Berkas & data">
          <Row
            icon="folder"
            iconFg="$info"
            iconBg="$infoSubtle"
            label="Berkas saya"
            note="Kontrak, sertifikat, dan dokumen perusahaan"
            chevron
            onPress={() => router.push("/berkas")}
          />
          <BersihkanCache />
        </Group>

        <Tampilan />
        <Notifikasi />

        <Group label="Keamanan & privasi">
          {/* gated by the caller, not by the row: a row that renders null inside
              a Group would leave its divider behind */}
          {passkeyAvailable() ? <PasskeyRow ids={me.data?.passkeys ?? []} /> : null}
          <Row
            icon="map-pin"
            iconFg={trail.data ? "$success" : "$fgMuted"}
            iconBg={trail.data ? "$successSubtle" : "$inset"}
            label="Jejak lokasi jam kerja"
            note={
              trail.data
                ? "Aktif selama Anda absen masuk · berhenti saat absen keluar"
                : "Izin lokasi “selalu” belum diberikan"
            }
            chevron
            onPress={() => Linking.openSettings()}
          />
        </Group>

        <Group label="Tentang">
          <Row
            icon="info"
            label="Tentang aplikasi"
            note="Versi, perusahaan, dan kebijakan"
            chevron
            onPress={() => router.push("/tentang")}
          />
        </Group>

        <Btn tone="danger" onPress={keluar} marginTop={2}>
          Keluar dari akun
        </Btn>
      </ScrollView>
    </Screen>
  );
}

/**
 * Pick or shoot, square-crop, upload as the employee's own photo.
 *
 * 1:1 at 512px — an avatar is displayed at 46px and kept forever, so the file
 * should be small; the crop and the WebP encode are the same helper the clock-in
 * selfie uses, with different numbers. Posted to /api/me/photo, which takes the
 * employee id from the session: this screen cannot aim an upload at anyone else.
 */
function useAvatarUpload() {
  const qc = useQueryClient();

  const upload = useMutation({
    mutationFn: async (source: "camera" | "library") => {
      if (!canProcessImages()) throw new Error("Ganti foto butuh build ulang aplikasi");

      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        cameraType: ImagePicker.CameraType.front,
      };
      const picked =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (picked.canceled) return null;

      const out = await toWebp(picked.assets[0], { ratio: 1, width: 512, compress: 0.7 });
      const form = new FormData();
      form.append("photo", {
        uri: out.uri,
        name: "profil.webp",
        type: "image/webp",
      } as unknown as Blob);
      return postForm<{ key: string }>("/api/me/photo", form);
    },
    onSuccess: async (res) => {
      if (!res) return;
      // both carry avatars, and the key changed, so neither can be left stale
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["team"] });
      toast("Foto profil diperbarui");
    },
    onError: (e) => toast((e as Error).message),
  });

  const choose = () =>
    Alert.alert("Ganti foto profil", "Ambil foto baru atau pilih dari galeri.", [
      { text: "Batal", style: "cancel" },
      { text: "Ambil foto", onPress: () => upload.mutate("camera") },
      { text: "Pilih dari galeri", onPress: () => upload.mutate("library") },
    ]);

  return { choose, busy: upload.isPending };
}

/**
 * Terang / Gelap / Sistem (PRD-Mobile §6.7). The control is the whole section:
 * no card around it and no "Tema" row above it, because "Tampilan" plus three
 * labelled options already say what it does — a wrapper and a second label only
 * cost 50px of height and one more thing to read.
 *
 * Icons *and* words, unlike the three bare glyphs this replaced in the old Info
 * header: the glyph is what makes it scannable, the word is what makes it
 * announceable. Buttons stay 36px tall — the compactness comes from dropping the
 * chrome, not from shrinking the touch target.
 */
function Tampilan() {
  const { theme, setTheme } = usePrefs();

  return (
    <YStack gap={8}>
      <GroupLabel>Tampilan</GroupLabel>
      <Segmented
        value={theme}
        onChange={setTheme}
        marginBottom={0}
        options={[
          { value: "system", label: "Sistem", icon: "smartphone" },
          { value: "light", label: "Terang", icon: "sun" },
          { value: "dark", label: "Gelap", icon: "moon" },
        ]}
      />
    </YStack>
  );
}

/**
 * The one genuine switch in here: `push` is a stored preference and the token is
 * registered or dropped to match, so turning it off actually stops the approval
 * notifications instead of only remembering that you asked.
 */
function Notifikasi() {
  const { push, setPush } = usePrefs();
  const reason = usePushStatus((s) => s.reason);

  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (!on) {
        await unregisterFromPush();
        return;
      }
      const r = await registerForPush();
      if (!r.ok) throw new Error(r.reason);
    },
    // set the preference either way: a refused OS permission must not leave the
    // switch on, and the failure is already reported in the row's note
    onSettled: (_d, err, on) => setPush(on && !err),
  });

  /**
   * A refused permission and a token that could not be minted are the same thing
   * to the employee: push is on in their head and silent on their phone. Both are
   * reported in the row's note and both offer the device settings below it —
   * rather than a toast that is gone before it can be acted on.
   */
  const problem = toggle.isError
    ? ((toggle.error as Error).message ?? "Pemberitahuan tidak dapat diaktifkan")
    : push
      ? reason
      : null;
  const ok = push && !problem;

  return (
    <Group label="Notifikasi">
      <Row
        icon="bell"
        iconFg={ok ? "$success" : problem ? "$warning" : "$fgMuted"}
        iconBg={ok ? "$successSubtle" : problem ? "$warningSubtle" : "$inset"}
        label="Pemberitahuan"
        noteTone={problem ? "$warning" : "$fgSubtle"}
        note={
          problem ??
          (push
            ? "Aktif · kabar saat pengajuan disetujui atau ditolak"
            : "Nonaktif · Anda tidak diberi tahu saat pengajuan diputuskan")
        }
        loading={toggle.isPending}
        right={
          <Toggle
            label="Pemberitahuan"
            checked={push}
            onChange={(on) => toggle.mutate(on)}
            disabled={toggle.isPending}
          />
        }
      />
      {problem ? (
        <Row
          icon="settings"
          label="Buka setelan perangkat"
          note="Izinkan pemberitahuan untuk Ruang HR"
          chevron
          onPress={() => Linking.openSettings()}
        />
      ) : null}
    </Group>
  );
}

/**
 * Enrol this device's biometric (PRD-Mobile §7). One-way on purpose: the app can
 * bind a passkey but has no endpoint to list or remove them, so this is a row
 * with an action rather than a switch that could not honour being turned off.
 */
function PasskeyRow({ ids }: { ids: string[] }) {
  const mine = usePrefs((s) => s.passkeyIds);
  const qc = useQueryClient();

  /**
   * Which of the account's passkeys live on this phone.
   *
   * Both halves are needed: the local list alone survives a passkey deleted from
   * the web console, and the server list alone cannot say *which* device holds
   * one. Their intersection answers both — and shrinks by itself when a
   * credential is revoked, so there is nothing to reset.
   */
  const here = mine.filter((id) => ids.includes(id)).length;
  const elsewhere = ids.length - here;

  const daftar = useMutation({
    mutationFn: enrollPasskey,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast("Passkey terdaftar · lain kali cukup biometrik");
    },
    onError: (e) => toast((e as Error).message),
  });

  return (
    <Row
      icon={here ? "check-circle" : "shield"}
      iconFg={here ? "$success" : "$accent"}
      iconBg={here ? "$successSubtle" : "$accentSubtle"}
      label="Masuk dengan biometrik"
      noteTone={here ? "$success" : "$fgSubtle"}
      note={
        here
          ? elsewhere
            ? `Terdaftar di perangkat ini · dan ${elsewhere} perangkat lain`
            : "Terdaftar di perangkat ini · aktif untuk login berikutnya"
          : elsewhere
            ? `Aktif di ${elsewhere} perangkat lain · daftarkan yang ini juga`
            : "Gunakan sidik jari atau Face ID perangkat"
      }
      loading={daftar.isPending}
      right={
        here || daftar.isPending ? null : (
          <Btn small tone="ghost" onPress={() => daftar.mutate()}>
            Daftarkan
          </Btn>
        )
      }
    />
  );
}

/** Drops the cached responses, not the session — for the "kenapa datanya masih
 *  yang lama" case that a pull-to-refresh on one screen does not cover. */
function BersihkanCache() {
  const qc = useQueryClient();

  return (
    <Row
      icon="trash-2"
      label="Bersihkan cache aplikasi"
      note="Muat ulang data dari server"
      chevron
      onPress={() => {
        qc.clear();
        toast("Cache dibersihkan");
      }}
    />
  );
}
