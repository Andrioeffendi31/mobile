/**
 * Entry bundel, bukan `"main": "expo-router/entry"` langsung.
 *
 * expo-router memuat modul rute secara MALAS — `require.context` membangun peta
 * modulnya, tapi `loadRoute()` baru benar-benar mengevaluasi berkasnya saat
 * dirender. Peluncuran headless dari OS (antar lokasi latar belakang, jalankan
 * watchdog, bangun setelah jaringan kembali) memulai runtime JS tanpa satu pun
 * surface: `reactHost.start()` dan tidak ada yang lain. Tidak ada yang dirender,
 * jadi tidak ada satu pun rute yang dievaluasi.
 *
 * Selama `background-ping` hanya diimpor dari `app/_layout.tsx` dan dua layar
 * tab, itu berarti kedua `TaskManager.defineTask` di dalamnya TIDAK PERNAH
 * terpanggil di jalur headless — task-nya terdaftar di OS tapi tidak punya isi —
 * dan listener NetInfo-nya tidak pernah terpasang. Praktisnya: satu-satunya yang
 * pernah menjalankan deteksi offline dan pengiriman ping susulan adalah pengguna
 * yang membuka aplikasinya. Diimpor dari sini, ia ikut di SETIAP peluncuran,
 * termasuk yang tanpa layar.
 *
 * `expo-router/entry` tetap duluan, dua alasan: ia hanya
 * `AppRegistry.registerComponent` (registrasi, bukan render — RN memanggil
 * `runApplication` setelah seluruh bundel selesai dievaluasi), jadi baris kedua
 * tetap berjalan sebelum frame pertama; dan `entry-classic` mensyaratkan
 * `@expo/metro-runtime` menjadi impor paling awal.
 */
import "expo-router/entry";
import "./src/background-ping";
