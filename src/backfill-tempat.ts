import * as Location from "expo-location";
import { get, postJson } from "@/api";

/**
 * Menyusulkan nama tempat untuk ping lokasi yang lahir tanpa nama.
 *
 * Kenapa perlu disusulkan. `expo-location` SENGAJA mematikan geocoder-nya selama
 * aplikasi berada di latar belakang: `OnActivityEntersBackground` memanggil
 * `stopWatching()` yang menyalakan `mGeocoderPaused`, dan setiap
 * `reverseGeocode` sesudah itu melempar "Geocoder is not running". Dokumen
 * paketnya pun menyarankan hal yang sama. Ping lokasi justru lahir di latar
 * belakang — jadi koordinatnya benar, namanya kosong.
 *
 * Foreground service saat clock in TIDAK menolong: yang dibaca paket itu adalah
 * daur hidup Activity, bukan service.
 *
 * Jadi ini dijalankan saat aplikasi benar-benar di depan, ketika geocoder-nya
 * hidup lagi. Bukan pengganti penerjemahan saat ping dibuat — yang itu tetap
 * dicoba dan tetap yang terbaik kalau kebetulan berhasil — melainkan jaring
 * kedua untuk yang gagal.
 */

/** Selaras dengan batas server. Geocoder Android menolak dibanjiri, dan
 *  dokumennya menyebut "too many requests at a time can result in an error". */
const MAKS = 12;

/** Jeda antar permintaan geocoder, sekali lagi karena ia mudah tersinggung. */
const JEDA_MS = 350;

type Kosong = { id: number; lat: number; lng: number };

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Format yang sama dengan namaTempat di background-ping.ts — kalau keduanya
 *  berbeda, satu hari yang sama akan memuat dua gaya penulisan alamat. */
function label(tempat: Location.LocationGeocodedAddress): string | null {
  const teks = [tempat.street, tempat.district ?? tempat.city]
    .filter(Boolean)
    .join(", ");
  return teks ? teks.slice(0, 120) : null;
}

export async function backfillNamaTempat(): Promise<number> {
  // izin FOREGROUND yang diminta geocoder Android, bukan background
  const izin = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!izin?.granted) return 0;

  const { items } = await get<{ items: Kosong[] }>("/api/me/ping-location");
  if (!items.length) return 0;

  const hasil: { id: number; location: string }[] = [];
  for (const [n, titik] of items.slice(0, MAKS).entries()) {
    if (n > 0) await tidur(JEDA_MS);
    const [tempat] = await Location.reverseGeocodeAsync({
      latitude: titik.lat,
      longitude: titik.lng,
    }).catch(() => []);
    if (!tempat) continue;
    const nama = label(tempat);
    if (nama) hasil.push({ id: titik.id, location: nama });
  }

  if (!hasil.length) return 0;
  // postJson menerima override method; tidak perlu helper kedua untuk satu PATCH
  await postJson("/api/me/ping-location", { items: hasil }, "PATCH");
  return hasil.length;
}
