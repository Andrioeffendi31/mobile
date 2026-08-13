# NanumHR Mobile

Aplikasi karyawan (Expo / React Native) untuk sistem yang sama dengan `../web`.
Spesifikasi: [`../PRD-Mobile.md`](../PRD-Mobile.md), desain:
[`../NanumHR Lite Mobile.dc.html`](../NanumHR%20Lite%20Mobile.dc.html).

## Menjalankan

```sh
cd ../web && npm run db:up && npm run dev   # backend + Postgres (podman)
cd ../mobile && npm start                   # lalu tekan i / a, atau scan QR
```

Base URL API ditebak dari host Metro (laptop yang menjalankan `npm run dev`),
jadi HP di Wi-Fi yang sama langsung tersambung. Untuk build atau backend lain:

```sh
EXPO_PUBLIC_API_URL=https://hr.example.com npm start
```

Login pakai akun karyawan mana pun dari seed — mis.
`citra.maharani@nanumindahsejati.co.id` / `securePass123`. Akun `hr_admin`
sengaja ditolak dengan pesan "gunakan versi web" (PRD-Mobile §4).

## Isi

| Berkas | Isi |
|---|---|
| `tamagui.config.ts` | palet mockup (`--accent`, `--success`, …) sebagai tema Tamagui |
| `src/api.ts` | satu-satunya kode yang bicara ke backend + sesi di `expo-secure-store` |
| `src/format.ts` | pemformatan tampilan; **tidak** ada aturan bisnis (semua final di server) |
| `src/ui.tsx` | bentuk yang diulang mockup (kartu, badge, chip, tombol) |
| `src/app/` | rute expo-router: `login` + lima tab |

## Build (Android saja)

`eas.json` punya tiga profil:

| Profil | Keluaran | Environment EAS | API yang dipakai |
|---|---|---|---|
| `development` | APK dev-client | `development` | **ditebak dari host Metro** — environment ini sengaja dibiarkan kosong, supaya `npm start` di laptop langsung terhubung ke `../web` |
| `preview` | APK internal | `preview` | `EXPO_PUBLIC_API_URL` dari dashboard |
| `production` | AAB (Play Store) | `production` | `EXPO_PUBLIC_API_URL` dari dashboard |

Nilainya **tidak** ada di repo ini. Setiap profil menunjuk ke sebuah environment
EAS lewat field `environment`, dan variabelnya hidup di
[dashboard Expo](https://expo.dev/accounts/andrioeffendi31/projects/nanumhr-mobile/environment-variables) —
> Proyek EAS-nya baru (`@andrioeffendi31/nanumhr-mobile`,
> `9a34e6ee-33ce-44ea-af59-7aca2774af79`), jadi URL di atas sudah cocok. `EXPO_PUBLIC_API_URL`
> sudah diisi untuk environment `preview` dan `production`; `development` sengaja dibiarkan
> kosong supaya `resolveBase()` di `src/api.ts` memakai host Metro untuk dev di LAN.
jadi mengganti backend tidak perlu commit. Untuk memakainya di mesin lokal:

```sh
eas env:pull preview     # menulis .env.local (sudah di-gitignore)
```

Hanya taruh nilai non-rahasia di sini: `EXPO_PUBLIC_*` di-inline ke dalam bundel
saat build, jadi siapa pun yang punya APK bisa membacanya.

```sh
eas build --platform android --profile development   # sekali, lalu pasang di HP
npm start                                            # sambungkan dev client
```

Expo Go **tidak cukup**: push notification, passkey, dan lokasi latar belakang
semuanya modul native.

Keystore sudah dibuat di EAS (`Build Credentials mhQCRFEFUj`), dan SHA-256-nya
sudah dipasang sebagai `ANDROID_CERT_SHA256` di Vercel (Production, Preview,
Development) — itulah yang membuat `/.well-known/assetlinks.json` dan verifikasi
origin passkey cocok.

> Kalau nanti rilis lewat Play Store dengan **Play App Signing**, Google
> menandatangani ulang APK dengan kuncinya sendiri. Ambil SHA-256 dari Play
> Console → *App integrity* dan tambahkan ke `ANDROID_CERT_SHA256` dipisah koma —
> route `assetlinks.json` sudah menerima daftar.

## Yang masih perlu Anda lakukan: FCM

Push di Android lewat Firebase Cloud Messaging, dan Firebase butuh akun Google
Anda — ini satu-satunya bagian yang tidak bisa disiapkan dari sini.

1. [console.firebase.google.com](https://console.firebase.google.com) → buat
   project (atau pakai yang ada) → **Add app › Android**.
2. Package name **harus** `app.nanumhr` (lihat `app.json` → `expo.android.package`).
3. Unduh `google-services.json`, taruh di `mobile/google-services.json`.
   (`app.json` sudah menunjuk ke path itu; file ini bukan rahasia, aman
   di-commit — dan **harus** ikut ter-commit, karena `eas build` mengunggah
   berdasarkan git.)
4. Firebase → ⚙️ *Project settings* › *Service accounts* › **Generate new private
   key** → simpan JSON-nya.
5. `eas credentials --platform android` → *Push Notifications: Manage your FCM V1
   service account key* → *Upload* → arahkan ke JSON dari langkah 4.

Sebelum langkah 3 selesai, `eas build` akan gagal dengan pesan
`google-services.json` tidak ditemukan — itu memang disengaja, daripada
menghasilkan APK yang tidak bisa menerima notifikasi.

Setelah semuanya beres, tab **Info** menampilkan status push (aktif, atau
alasannya kalau tidak) — jadi tidak perlu menebak dari log Metro.

## Passkey, push, dan lokasi latar belakang

Ketiganya butuh **development build** (bukan Expo Go) dan sebagian butuh nilai
dari akun Anda. Semuanya gagal dengan tenang kalau belum dikonfigurasi — tidak
ada yang crash.

| Fitur | Status |
|---|---|
| `expo.extra.eas.projectId` | ✅ terisi |
| Keystore + `ANDROID_CERT_SHA256` | ✅ dibuat & dipasang di Vercel |
| `assetlinks.json` | ✅ tersaji dari backend, terisi otomatis dari env di atas |
| FCM (`google-services.json` + service account) | ⬜ lihat bagian di atas |
| Lokasi latar belakang | ✅ hanya butuh izin "Izinkan sepanjang waktu" dari pengguna |

Tombol passkey **sengaja disembunyikan** saat aplikasi menunjuk ke server LAN
(`http://…`): passkey tidak bisa diikat ke host non-HTTPS, jadi profil
`development` tidak menampilkannya — pakai profil `preview` untuk mengujinya.

## Yang belum ada

- **Pengumuman baru → push.** Trigger ini ada di PRD-Mobile §6.6, tapi belum ada
  endpoint pembuatan pengumuman di web (pengumuman masih dari seed), jadi belum
  ada kejadian untuk dipicu.
- **Antrean mutasi offline.** Sesuai PRD-Mobile §3, di luar lingkup v1.
