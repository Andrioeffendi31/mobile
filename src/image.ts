import { requireOptionalNativeModule } from "expo";
import type { ImageResult } from "expo-image-manipulator";

/**
 * Turning a camera roll picture into something worth uploading.
 *
 * Shared by the clock-in selfie (3:4, 720px) and the profile photo (1:1, 512px),
 * which differ only in those two numbers — the cropping arithmetic, the format and
 * the reason for it are the same, and having written it twice would have meant
 * fixing an off-by-one twice.
 */

/**
 * Whether this binary was built with expo-image-manipulator in it.
 *
 * Asked before importing, not caught after: the module throws from its own module
 * scope, so even `await import()` inside a try only moves the explosion — Metro
 * evaluates the chunk and the throw surfaces as a redbox with no way back. This
 * asks the question without loading anything, and returns null instead of throwing
 * on a dev build made before the package was installed.
 */
export const canProcessImages = () =>
  requireOptionalNativeModule("ExpoImageManipulator") !== null;

/**
 * Centre-crop to `ratio` (width ÷ height), downscale, save as WebP.
 *
 * Cropped here rather than through the picker's editor: a crop screen is another
 * step between somebody and the thing they meant to do, and the middle of a
 * portrait is the face every time.
 *
 * WebP because these are stored forever — a punch every working day per employee,
 * a profile photo per person — and because it is the Android encoder's own format,
 * which is the only platform this app ships to (app.json `platforms`).
 */
export async function toWebp(
  asset: { uri: string; width: number; height: number },
  { ratio, width, compress = 0.6 }: { ratio: number; width: number; compress?: number },
): Promise<ImageResult> {
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const ctx = ImageManipulator.manipulate(asset.uri);

  // wider than the target → trim the sides; taller → trim top and bottom
  if (asset.width / asset.height > ratio) {
    const w = Math.round(asset.height * ratio);
    ctx.crop({
      originX: Math.round((asset.width - w) / 2),
      originY: 0,
      width: w,
      height: asset.height,
    });
  } else {
    const h = Math.round(asset.width / ratio);
    ctx.crop({
      originX: 0,
      originY: Math.round((asset.height - h) / 2),
      width: asset.width,
      height: h,
    });
  }

  ctx.resize({ width });
  const rendered = await ctx.renderAsync();
  return rendered.saveAsync({ format: SaveFormat.WEBP, compress });
}

/**
 * Turunkan resolusi sebuah gambar dan simpan sebagai WebP — TANPA memotong.
 *
 * Saudara `toWebp`, bukan pemanggilnya, karena keduanya menjawab dua hal berbeda.
 * `toWebp` membuat potret: ia memotong ke rasio tetap karena hasilnya akan
 * ditampilkan di dalam lingkaran atau bingkai 3:4. Yang ini menerima dokumen —
 * kontrak hasil pindaian, foto struk — dan memotong tengahnya berarti membuang
 * bagian yang justru dicari orang.
 *
 * Ia juga tidak menerima dimensi sumber, karena pemanggilnya tidak punya:
 * DocumentPicker hanya mengembalikan `{uri, name, size, mimeType}`.
 *
 * Lebarnya dibaca dulu dari hasil render, dan pengecilan hanya dilakukan kalau
 * gambarnya memang lebih lebar. Itu bukan optimasi melainkan koreksi kebenaran:
 * `resize()` bekerja dua arah, jadi tanpa penjaga ini sebuah foto struk 400px
 * justru DIBESARKAN ke 1600px dan berkasnya membengkak — kebalikan persis dari
 * tujuannya.
 *
 * 1600px: cukup untuk membaca teks pada dokumen A4 yang difoto, sekaligus
 * menurunkan foto 12 MP dari beberapa MB ke ratusan KB.
 */
export async function shrinkImage(
  uri: string,
  maxWidth = 1600,
  compress = 0.72,
): Promise<ImageResult> {
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");

  const asli = await ImageManipulator.manipulate(uri).renderAsync();
  const hasil =
    asli.width > maxWidth
      ? await ImageManipulator.manipulate(asli).resize({ width: maxWidth }).renderAsync()
      : asli;

  return hasil.saveAsync({ format: SaveFormat.WEBP, compress });
}

/** Ekstensi tanpa titik, huruf besar; "" kalau tidak ada. */
const extOf = (name: string) =>
  name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : "";

/** Nama asal dengan ekstensi diganti. */
export const gantiEkstensi = (name: string, ext: string) =>
  `${name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name}.${ext}`;

/**
 * HEIC/HEIF ikut meski BUKAN format yang diterima server (`heic` tidak ada di
 * DOC_EXT) — justru itu gunanya: foto iPhone lolos karena sudah menjadi WebP
 * sebelum sampai ke sana.
 */
const COMPRESSIBLE = new Set(["JPG", "JPEG", "PNG", "WEBP", "GIF", "HEIC", "HEIF"]);

/**
 * Di bawah ini mengubah sandi ulang hanya membuang waktu — sebuah tanda tangan
 * pindaian 40 KB tidak akan menyusut lagi, dan penggunanya menunggu percuma.
 */
const AMBANG_KOMPRESI = 600 * 1024;

/** Bagian multipart React Native: {uri,name,type}, bukan Blob. */
export type BagianUnggah = { uri: string; name: string; type: string };

/**
 * Satu berkas pilihan menjadi bagian multipart yang layak diunggah — dikecilkan
 * kalau ia gambar, apa adanya kalau bukan.
 *
 * Dipakai oleh unggahan Berkas DAN lampiran pengajuan. Sebelumnya hanya Berkas
 * yang mengecilkan, dan salinan kedua aturannya di layar pengajuan berarti
 * memperbaiki satu bug harus dilakukan dua kali — jadi aturannya tinggal di sini,
 * bukan di layarnya.
 *
 * Kompresinya di ponsel dan bukan di server karena yang mahal bukan CPU-nya
 * melainkan perjalanannya: bucket R2 hanya 10 GB, dan satu foto 12 MP yang
 * diunggah utuh memakan jatah yang sama dengan puluhan dokumen.
 *
 * Tiga penjaga sebelum mengecilkan, masing-masing menjawab kegagalan yang
 * berbeda: `canProcessImages()` untuk build lama yang belum memuat
 * expo-image-manipulator, `AMBANG_KOMPRESI` untuk berkas yang memang sudah kecil,
 * dan `try/catch` untuk berkas rusak atau format asing — unggahan yang gagal
 * dikompres harus tetap TERUNGGAH, bukan gagal sama sekali.
 */
export async function siapkanUnggahan(file: {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
}): Promise<BagianUnggah> {
  const apaAdanya: BagianUnggah = {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? "application/octet-stream",
  };

  if (
    !COMPRESSIBLE.has(extOf(file.name)) ||
    !canProcessImages() ||
    (file.size ?? 0) <= AMBANG_KOMPRESI
  ) {
    return apaAdanya;
  }

  try {
    const kecil = await shrinkImage(file.uri);
    /**
     * Namanya ikut berganti ekstensi, dan itu wajib: nama inilah yang dipakai
     * server sebagai nama unduhan, jadi menyimpan nama .jpg untuk byte WebP
     * berarti menyerahkan berkas yang tidak bisa dibuka galeri orangnya. Nama,
     * kolom `ext`, dan object key harus sepakat.
     */
    return {
      uri: kecil.uri,
      name: gantiEkstensi(file.name, "webp"),
      type: "image/webp",
    };
  } catch (error) {
    console.warn("[unggah] gagal mengecilkan", (error as Error).message);
    return apaAdanya;
  }
}
