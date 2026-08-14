import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Text, YStack } from "tamagui";
import { tint } from "@/theme";
import { Btn, Screen } from "@/ui";

/**
 * Notifikasi wajib, dan gerbang ini yang memaksanya.
 *
 * Kenapa penghalang milik sendiri dan bukan sekadar memanggil ulang dialog OS:
 * sejak Android 13, sekali pengguna menekan "Jangan izinkan", `canAskAgain`
 * menjadi false dan **dialog sistem tidak akan pernah muncul lagi** dari
 * `requestPermissionsAsync()`. Jadi "tanyakan lagi setiap aplikasi dibuka" hanya
 * bisa dipenuhi oleh layar ini, yang muncul di tiap peluncuran selama izinnya
 * belum ada, dan mengantar ke Pengaturan sistem begitu jatah dialog OS habis.
 *
 * Ia mengembalikan `null` — bukan me-redirect — supaya benar-benar tidak bisa
 * dilewati: pemanggilnya merender ini SEBAGAI GANTI <Stack>, bukan di sampingnya,
 * jadi tidak ada rute apa pun yang hidup di belakangnya untuk dituju deep link.
 */

type Keadaan = "memeriksa" | "boleh" | "minta" | "setelan" | "ditolak";

/** Jeda sebelum menutup: aplikasi yang lenyap tanpa sepatah kata tidak bisa
 *  dibedakan dari aplikasi yang crash, dan orang yang mengira aplikasinya rusak
 *  tidak akan kembali untuk memberi izin. */
const JEDA_TUTUP = 2200;

export function IzinNotifikasi({ children }: { children: React.ReactNode }) {
  const [keadaan, setKeadaan] = useState<Keadaan>("memeriksa");

  const periksa = useCallback(async () => {
    const izin = await Notifications.getPermissionsAsync();
    if (izin.granted) setKeadaan("boleh");
    else setKeadaan(izin.canAskAgain ? "minta" : "setelan");
  }, []);

  useEffect(() => {
    void periksa();
  }, [periksa]);

  // Pulang dari Pengaturan sistem membuka gerbangnya sendiri, tanpa perlu
  // menutup dan membuka aplikasi lagi.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void periksa();
    });
    return () => sub.remove();
  }, [periksa]);

  useEffect(() => {
    if (keadaan !== "ditolak") return;
    const t = setTimeout(() => BackHandler.exitApp(), JEDA_TUTUP);
    return () => clearTimeout(t);
  }, [keadaan]);

  if (keadaan === "boleh") return <>{children}</>;
  // satu-dua frame sebelum jawabannya datang: latar bertema, sama seperti gerbang
  // sesi — apa pun yang lain akan berkedip menjadi bentuk yang salah
  if (keadaan === "memeriksa") return <Screen />;

  const minta = async () => {
    const izin = await Notifications.requestPermissionsAsync();
    if (izin.granted) setKeadaan("boleh");
    else setKeadaan("ditolak");
  };

  return (
    <Screen justifyContent="center" paddingHorizontal={28} gap={14}>
      <YStack
        alignSelf="flex-start"
        backgroundColor={keadaan === "ditolak" ? "$dangerSubtle" : "$accentSubtle"}
        borderRadius={16}
        padding={12}
      >
        <Feather
          name={keadaan === "ditolak" ? "bell-off" : "bell"}
          size={22}
          color={tint(keadaan === "ditolak" ? "$danger" : "$accent")}
        />
      </YStack>

      <Text fontSize={20} fontWeight="700" color="$fg">
        {keadaan === "ditolak" ? "Aplikasi ditutup" : "Aktifkan notifikasi"}
      </Text>

      <Text fontSize={13.5} color="$fgMuted" lineHeight={20}>
        {keadaan === "ditolak"
          ? "Notifikasi wajib aktif untuk memakai NanumHR. Buka aplikasi ini lagi setelah izinnya diberikan."
          : "NanumHR memakai notifikasi untuk mengingatkan absen masuk dan keluar, serta memberi tahu hasil pengajuan cuti dan lembur Anda. Tanpa izin ini, pemberitahuannya tidak akan pernah sampai."}
      </Text>

      {keadaan === "setelan" && (
        <Text fontSize={12.5} color="$fgSubtle" lineHeight={19}>
          Android tidak lagi menampilkan permintaan izin setelah ditolak sekali.
          Nyalakan lewat Pengaturan → Notifikasi.
        </Text>
      )}

      {keadaan !== "ditolak" && (
        <YStack gap={9} marginTop={4}>
          <Btn onPress={keadaan === "minta" ? minta : () => void Linking.openSettings()}>
            {keadaan === "minta" ? "Izinkan notifikasi" : "Buka pengaturan"}
          </Btn>
          <Btn tone="ghost" onPress={() => BackHandler.exitApp()}>
            Tutup aplikasi
          </Btn>
        </YStack>
      )}
    </Screen>
  );
}
