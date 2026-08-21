import { useRef, useState } from "react";
import { Animated, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useIsFocused, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, YStack, useTheme } from "tamagui";
import { type Bootstrap, get, logout, postForm } from "@/api";
import { openBatteryOptimizationExemption } from "@/battery-optimization";
import { canPingInBackground } from "@/background-ping";
import { canProcessImages, toWebp } from "@/image";
import { available as passkeyAvailable, enrollPasskey } from "@/passkey";
import { registerForPush, unregisterFromPush, usePushStatus } from "@/push";
import { usePrefs } from "@/prefs";
import { LEAD_MINUTES } from "@/reminders";
import { tint } from "@/theme";
import { toast } from "@/toast";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  ConfirmSheet,
  ErrorNote,
  Group,
  GroupLabel,
  Mono,
  Row,
  Screen,
  Segmented,
  Skeleton,
  Toggle,
} from "@/ui";

/**
 * Pengaturan — dirancang ulang mengikuti One UI (§ redesign-existing-projects).
 *
 * Yang membuat sebuah layar terbaca sebagai One UI bukan warnanya, melainkan tiga
 * hal yang semuanya soal jangkauan ibu jari pada ponsel 6,7 inci:
 *
 * 1. **Judul besar yang menyusut.** Sepertiga layar bagian atas sengaja dibiarkan
 *    kosong selain sebuah judul 32px. Ia bukan hiasan: ia mendorong baris pertama
 *    yang bisa ditekan turun ke separuh bawah layar, dan ia menyusut menjadi bar
 *    ringkas begitu digulirkan sehingga ruang itu dikembalikan.
 * 2. **Kartu membulat besar tanpa garis pemisah** — lihat <Group> di ui.tsx.
 * 3. **Baris yang lapang** (64px, sisi 20px) dan judul seksi berwarna aksen.
 *
 * Setiap baris di sini tetap didukung sesuatu yang sungguh ada — preferensi
 * tersimpan, izin OS, endpoint passkey, cache query. Tidak ada sakelar hiasan:
 * setelan yang tidak berpengaruh lebih buruk daripada setelan yang tidak ada.
 */

/**
 * Tinggi judul besar sampai batas bawahnya — dipakai untuk memilih kapan bar
 * ringkas muncul, bukan untuk menyisakan ruang di atasnya. Jarak dari status bar
 * sama persis dengan Kehadiran dan Tim (insets.top + 18): One UI melapangkan
 * layar lewat ukuran hurufnya, bukan dengan mendorong judulnya ke tengah.
 */
const JUDUL = 56;

export default function Pengaturan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const isFocused = useIsFocused();
  const avatar = useAvatarUpload();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
    enabled: isFocused,
  });

  // the trail is started by the Beranda when the day starts; this reads the
  // permission back so "HR cannot see my location" has an answer in the app
  const trail = useQuery({
    queryKey: ["bg-location"],
    queryFn: canPingInBackground,
    enabled: isFocused,
  });
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: ({ signal }) => get<{ ids: string[] }>("/api/me/passkeys", { signal }),
    enabled: isFocused && passkeyAvailable(),
  });

  const [confirmKeluar, setConfirmKeluar] = useState(false);

  /**
   * Posisi gulir, sebagai Animated.Value dan bukan state React.
   *
   * `useNativeDriver` memindahkan interpolasinya ke thread UI, jadi bar ringkas
   * memudar tanpa satu pun render React per frame. Menyimpannya sebagai state
   * berarti me-render ulang seluruh layar Pengaturan enam puluh kali per detik
   * selama jari masih menyentuh layar.
   */
  const gulir = useRef(new Animated.Value(0)).current;
  const barMuncul = gulir.interpolate({
    inputRange: [JUDUL * 0.3, JUDUL],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  // clear the cache too: the next person to sign in on this phone must not see
  // the previous employee's cached leave balance for a frame
  const keluar = async () => {
    await unregisterFromPush();
    await logout();
    qc.clear();
  };

  return (
    <Screen>
      <Animated.ScrollView
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: gulir } } }], {
          useNativeDriver: true,
        })}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 18,
        }}
      >
        {/* Judul besar One UI. Tanpa subjudul, tidak seperti Kehadiran: nama
            layarnya sudah ada di tab bar, dan "Akun, berkas, keamanan dan
            preferensi" hanya membacakan ulang daftar yang persis ada di bawahnya. */}
        <Text
          fontSize={32}
          lineHeight={38}
          fontWeight="700"
          color="$fg"
          letterSpacing={-0.9}
          paddingLeft={4}
        >
          Pengaturan
        </Text>

        {me.isPending ? (
          // bentuknya persis kartu akun di bawah, sampai ke radius 26-nya: yang
          // muncul saat menunggu harus layar yang sama, dengan isinya menyusul
          <Card flexDirection="row" borderRadius={26} padding={18} gap={15}>
            <Skeleton width={56} height={56} radius={20} />
            <YStack flex={1} gap={9} justifyContent="center">
              <Skeleton width="56%" height={15} />
              <Skeleton width="78%" height={11} />
            </YStack>
          </Card>
        ) : me.isError ? (
          <ErrorNote message={(me.error as Error).message} onRetry={me.refetch} />
        ) : (
          /**
           * Kartu akun — padanan baris "Samsung account" di puncak Pengaturan One
           * UI. Ia menggantikan baris "Profil saya" yang dulu ada di grup di
           * bawah: satu tujuan tidak perlu dua pintu, dan kartu inilah yang lebih
           * mudah dikenali sebagai "ini saya".
           *
           * Dua sasaran sentuh di dalam satu kartu: avatarnya mengganti foto,
           * sisanya membuka Profil. Persis pembagian yang dipakai One UI.
           */
          <Card
            flexDirection="row"
            borderRadius={26}
            padding={18}
            alignItems="center"
            gap={15}
            pressStyle={{ backgroundColor: "$inset" }}
            onPress={() => router.push("/profil")}
            accessibilityRole="button"
            aria-label={`Profil ${me.data.profile.name}`}
          >
            <YStack
              pressStyle={{ opacity: 0.7 }}
              onPress={avatar.choose}
              accessibilityRole="button"
              aria-label="Ganti foto profil"
            >
              <Avatar
                seed={me.data.profile.id}
                initials={me.data.profile.initials}
                photoKey={isFocused ? me.data.profile.photoKey : null}
                size={56}
                borderRadius={20}
                opacity={avatar.busy ? 0.5 : 1}
              />
              {/* a badge, because a tappable avatar with nothing on it is a secret */}
              <YStack
                position="absolute"
                right={-4}
                bottom={-4}
                width={23}
                height={23}
                borderRadius={12}
                backgroundColor="$accentFill"
                borderWidth={2.5}
                borderColor="$surface"
                alignItems="center"
                justifyContent="center"
              >
                <Feather name="camera" size={10} color="#fff" />
              </YStack>
            </YStack>

            <YStack flex={1} gap={4}>
              <Text fontSize={17} fontWeight="600" color="$fg" numberOfLines={1}>
                {me.data.profile.name}
              </Text>
              <Mono fontSize={12.5} color="$fgSubtle" numberOfLines={1}>
                {me.data.profile.nik} · {me.data.profile.division}
              </Mono>
            </YStack>
            <Badge label="Aktif" fg="$success" bg="$successSubtle" />
            <Feather name="chevron-right" size={18} color={tint("$fgSubtle")} />
          </Card>
        )}

        <Group label="Berkas dan data">
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
        <Notifikasi shift={me.data?.shift} />

        <Group label="Keamanan dan privasi">
          {/* gated by the caller, not by the row: <Group> menghitung anaknya untuk
              memutuskan apakah kartunya perlu digambar sama sekali */}
          {passkeyAvailable() ? <PasskeyRow ids={passkeys.data?.ids ?? []} /> : null}
          <Row
            icon="lock"
            iconFg="$fgMuted"
            iconBg="$inset"
            label="Ganti kata sandi"
            note="Berlaku juga untuk masuk lewat web"
            chevron
            onPress={() => router.push("/ganti-sandi")}
          />
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
          {/*
            Separuh jawaban lain atas "kenapa jejak saya bolong": ROM Xiaomi, Oppo
            dan Vivo mematikan layanan latar belakang secara agresif, dan tidak ada
            API yang bisa mencegahnya dari dalam aplikasi.

            Intent daftar sistem, bukan REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: yang
            terakhir butuh izin bernama sama yang masuk daftar terbatas Play Store,
            dan aplikasi yang sudah memegang ACCESS_BACKGROUND_LOCATION tidak perlu
            bendera kedua demi satu dialog yang dua ketukan lagi juga sampai.

            Activity "autostart" bawaan OEM sengaja tidak di-hardcode: namanya tidak
            terdokumentasi, berbeda antar versi ROM, dan sendIntent melempar kalau
            activity-nya tidak ada. Kalimat di bawah lebih tahan lama daripada
            intent yang rusak pada pembaruan MIUI berikutnya.
          */}
          {Platform.OS === "android" ? (
            <Row
              icon="battery-charging"
              iconFg="$fgMuted"
              iconBg="$inset"
              label="Izinkan berjalan di latar belakang"
              note="Pilih “Tidak dibatasi/Unrestricted” untuk NanumHR. Di Xiaomi/Oppo/Vivo, nyalakan juga “Autostart / Mulai otomatis”."
              chevron
              onPress={() => void openBatteryOptimizationExemption()}
            />
          ) : null}
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

        {/**
         * Keluar sebagai baris merah di kartunya sendiri, bukan tombol merah pekat
         * selebar layar. One UI menutup daftar setelan dengan sebuah baris — dan
         * baris itu tetap terbaca sebagai tindakan merusak karena judul dan
         * ikonnya merah, tanpa satu bidang merah yang menarik mata ke bawah
         * mendahului segala sesuatu di atasnya.
         */}
        <Group>
          <Row
            icon="log-out"
            iconFg="$danger"
            iconBg="$dangerSubtle"
            label="Keluar dari akun"
            labelTone="$danger"
            note="Anda perlu masuk lagi untuk mencatat absensi"
            onPress={() => setConfirmKeluar(true)}
          />
        </Group>
      </Animated.ScrollView>

      {/**
       * Bar ringkas yang menggantikan judul besar setelah digulirkan.
       *
       * Di luar ScrollView dan absolut di atasnya, jadi ia tetap diam sementara
       * isinya lewat di bawahnya. `pointerEvents="none"` tanpa syarat: tidak ada
       * apa pun di dalamnya yang bisa ditekan, dan bar tak terlihat yang memakan
       * sentuhan di sepertiga atas layar adalah bug yang mahal ditemukan.
       */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top,
          backgroundColor: theme.bg?.val,
          opacity: barMuncul,
        }}
      >
        <YStack height={52} justifyContent="center" paddingHorizontal={20}>
          <Text fontSize={17} fontWeight="600" color="$fg">
            Pengaturan
          </Text>
        </YStack>
        <YStack height={1} backgroundColor="$line" />
      </Animated.View>

      <ConfirmSheet
        open={confirmKeluar}
        onClose={() => setConfirmKeluar(false)}
        title="Keluar dari akun?"
        message="Anda perlu masuk lagi untuk mencatat absensi."
        actions={[{ label: "Keluar", tone: "danger", onPress: () => void keluar() }]}
      />
      {avatar.sheet}
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

  // the sheet travels with the hook rather than being rebuilt at the call site:
  // the two options and the mutation they drive are one thing
  const [open, setOpen] = useState(false);

  const sheet = (
    <ConfirmSheet
      open={open}
      onClose={() => setOpen(false)}
      title="Ganti foto profil"
      message="Ambil foto baru atau pilih dari galeri."
      actions={[
        { label: "Ambil foto", onPress: () => upload.mutate("camera") },
        { label: "Pilih dari galeri", tone: "ghost", onPress: () => upload.mutate("library") },
      ]}
    />
  );

  return { choose: () => setOpen(true), busy: upload.isPending, sheet };
}

/**
 * Terang / Gelap / Sistem (PRD-Mobile §6.7). Tetap satu pilihan tiga arah dan
 * bukan baris menuju sub-halaman: tiga opsi berlabel sudah menjelaskan dirinya,
 * dan One UI pun menaruh pilihan mode gelapnya langsung di halaman, bukan di
 * balik satu ketukan lagi.
 *
 * Yang berubah hanyalah bungkusnya: dulu kontrol ini melayang di atas latar
 * halaman, satu-satunya blok di layar ini yang tidak berada di dalam kartu.
 * Sekarang ia duduk di kartu radius 26 yang sama dengan grup lainnya, dengan
 * pilihannya sendiri beradius 9 — sudut yang lebih rapat di dalam sudut yang
 * lebih lebar, yang membuat susunannya terbaca berlapis alih-alih sejajar.
 */
function Tampilan() {
  const { theme, setTheme } = usePrefs();

  return (
    <YStack gap={9}>
      <GroupLabel>Tampilan</GroupLabel>
      <Card borderRadius={26} padding={14} gap={11}>
        <Text fontSize={15} fontWeight="500" color="$fg" paddingHorizontal={6}>
          Tema aplikasi
        </Text>
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
      </Card>
    </YStack>
  );
}

/**
 * The one genuine switch in here: `push` is a stored preference and the token is
 * registered or dropped to match, so turning it off actually stops the approval
 * notifications instead of only remembering that you asked.
 */
function Notifikasi({ shift }: { shift?: Bootstrap["shift"] }) {
  const { push, setPush, reminder, setReminder } = usePrefs();
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
      {/**
       * Separate from Pemberitahuan on purpose: that switch is about news the
       * server sends, this one makes the phone ring on a schedule it already
       * knows. Turning one off should not silence the other.
       */}
      <Row
        icon="clock"
        iconFg={reminder ? "$accent" : "$fgMuted"}
        iconBg={reminder ? "$accentSubtle" : "$inset"}
        label="Pengingat absen"
        noteTone={reminder ? "$accent" : "$fgSubtle"}
        note={
          reminder
            ? `Berbunyi & bergetar Senin–Jumat, ${LEAD_MINUTES} menit sebelum ${shift ? `${shift.start} & ${shift.end}` : "jam shift"}`
            : `Nonaktif · alarm ${LEAD_MINUTES} menit sebelum jam masuk dan jam keluar`
        }
        right={
          <Toggle label="Pengingat absen" checked={reminder} onChange={setReminder} />
        }
      />
      {problem ? (
        <Row
          icon="settings"
          label="Buka setelan perangkat"
          note="Izinkan pemberitahuan untuk NanumHR"
          chevron
          onPress={() => Linking.openSettings()}
        />
      ) : null}
    </Group>
  );
}

/**
 * Enrol this device's biometric (PRD-Mobile §7). One-way on purpose: the app can
 * bind and list passkeys but does not remove them, so this is a row with an
 * action rather than a switch that could not honour being turned off.
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
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
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
