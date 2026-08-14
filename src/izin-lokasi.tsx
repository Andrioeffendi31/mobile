import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Text, YStack } from "tamagui";
import { create } from "zustand";
import { tint } from "@/theme";
import { Btn, Screen } from "@/ui";

/**
 * Lokasi wajib, dan gerbang ini yang memaksanya — sebagaimana IzinNotifikasi
 * memaksa notifikasi.
 *
 * Kenapa tidak cukup memanggil ulang `requestBackgroundPermissionsAsync()`:
 * sejak Android 11, dialog izin sistem **tidak lagi memuat pilihan "Izinkan
 * sepanjang waktu"**. Permintaan izin latar belakang karena itu tidak menampilkan
 * apa pun dan langsung terjawab "ditolak" — persis yang terlihat sebagai toast
 * "izin lokasi latar belakang ditolak" tanpa satu pun dialog sebelumnya. Satu-
 * satunya jalan yang tersisa adalah halaman Pengaturan aplikasi, dan tugas layar
 * ini adalah mengantar ke sana lalu memeriksa lagi saat penggunanya kembali.
 *
 * Dua langkah, karena Android memang menuntutnya berurutan: izin lokasi biasa
 * dulu (dialognya masih ada dan masih berfungsi), baru izin latar belakang.
 * Meminta keduanya sekaligus membuat sistem mengabaikan permintaannya dan tidak
 * memberikan izin apa pun.
 */

type Keadaan = "memeriksa" | "boleh" | "depan" | "latar";

/**
 * Sudah boleh atau belum, sebagai store — bukan state lokal.
 *
 * `<Trail>` hidup di luar gerbang ini dan tidak punya cara lain untuk tahu bahwa
 * izinnya baru saja berubah: di Android 11+ perubahannya selalu lewat Pengaturan,
 * jadi AppState "active" sudah cukup, tapi di Android 10 dialognya bisa memberi
 * izin latar belakang tanpa aplikasinya pernah ditinggalkan — dan tanpa store ini
 * jejaknya baru menyala pada peluncuran berikutnya.
 */
export const useIzinLokasi = create<{ boleh: boolean }>(() => ({ boleh: false }));

export function IzinLokasi({ children }: { children: React.ReactNode }) {
  const [keadaan, setKeadaan] = useState<Keadaan>("memeriksa");
  /** Dialog OS untuk izin lokasi biasa sudah habis jatahnya. */
  const [buntu, setBuntu] = useState(false);

  const periksa = useCallback(async () => {
    const depan = await Location.getForegroundPermissionsAsync();
    if (depan.status !== "granted") {
      useIzinLokasi.setState({ boleh: false });
      setBuntu(!depan.canAskAgain);
      setKeadaan("depan");
      return;
    }
    const latar = await Location.getBackgroundPermissionsAsync();
    const boleh = latar.status === "granted";
    useIzinLokasi.setState({ boleh });
    setKeadaan(boleh ? "boleh" : "latar");
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

  if (keadaan === "boleh") return <>{children}</>;
  if (keadaan === "memeriksa") return <Screen />;

  const minta = async () => {
    if (keadaan === "depan") {
      // dialognya masih berfungsi untuk izin lokasi biasa — selama jatahnya ada
      if (buntu) return void Linking.openSettings();
      const izin = await Location.requestForegroundPermissionsAsync();
      setBuntu(!izin.canAskAgain);
      return void periksa();
    }
    /**
     * Tetap dicoba lebih dulu, meski di Android 11+ ia tidak menampilkan apa pun:
     * di Android 10 dialognya masih memuat "Izinkan sepanjang waktu", dan menebak
     * versi Android lalu salah menebak berarti mengirim orang ke Pengaturan untuk
     * sesuatu yang sebenarnya bisa dijawab satu ketukan.
     */
    const izin = await Location.requestBackgroundPermissionsAsync();
    if (izin.status === "granted") return void periksa();
    await Linking.openSettings();
  };

  const depan = keadaan === "depan";

  return (
    <Screen justifyContent="center" paddingHorizontal={28} gap={14}>
      <YStack
        alignSelf="flex-start"
        backgroundColor="$accentSubtle"
        borderRadius={16}
        padding={12}
      >
        <Feather name="map-pin" size={22} color={tint("$accent")} />
      </YStack>

      <Text fontSize={20} fontWeight="700" color="$fg">
        {depan ? "Aktifkan izin lokasi" : "Izinkan lokasi sepanjang waktu"}
      </Text>

      <Text fontSize={13.5} color="$fgMuted" lineHeight={20}>
        {depan
          ? "NanumHR memakai lokasi untuk memastikan absen masuk dan keluar dilakukan di area kantor. Tanpa izin ini, Anda tidak bisa absen sama sekali."
          : "Jejak lokasi dicatat tiap ~3 jam selama Anda masih absen masuk, dan berhenti begitu Anda absen keluar. Izin “sepanjang waktu” yang membuatnya tetap tercatat saat aplikasi tidak sedang dibuka."}
      </Text>

      {!depan && (
        <Text fontSize={12.5} color="$fgSubtle" lineHeight={19}>
          Android tidak lagi menawarkan pilihan ini lewat popup. Di halaman
          Pengaturan yang terbuka nanti, pilih Izin → Lokasi → “Izinkan sepanjang
          waktu”.
        </Text>
      )}

      {depan && buntu && (
        <Text fontSize={12.5} color="$fgSubtle" lineHeight={19}>
          Permintaan izin sudah ditolak sebelumnya, jadi Android tidak akan
          menampilkannya lagi. Nyalakan lewat Pengaturan → Izin → Lokasi.
        </Text>
      )}

      <YStack gap={9} marginTop={4}>
        <Btn onPress={minta}>
          {depan
            ? buntu
              ? "Buka pengaturan"
              : "Izinkan lokasi"
            : "Buka pengaturan lokasi"}
        </Btn>
        <Btn tone="ghost" onPress={() => BackHandler.exitApp()}>
          Tutup aplikasi
        </Btn>
      </YStack>
    </Screen>
  );
}
