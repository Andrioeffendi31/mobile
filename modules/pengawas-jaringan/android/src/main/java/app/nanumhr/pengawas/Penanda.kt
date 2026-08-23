package app.nanumhr.pengawas

import android.content.Context

/**
 * Keadaan episode offline, di SharedPreferences.
 *
 * Bukan SecureStore tempat sisi JS menyimpan miliknya: berkas itu terenkripsi dan
 * hanya bisa dibuka dari JS, sementara job ini justru berjalan ketika tidak ada
 * JS sama sekali. Kedua pihak karena itu memegang penandanya masing-masing, dan
 * yang menyatukan mereka bukan penanda melainkan notifikasinya sendiri — keduanya
 * memakai tag dan id yang sama persis (lihat [PengawasJaringanJob.NOTIF_TAG]),
 * jadi yang satu menimpa yang lain alih-alih menumpuk.
 */
internal object Penanda {
  private const val NAMA = "nanumhr.pengawas-jaringan"
  private const val SEJAK = "sejak"
  private const val SUDAH_BERI_TAHU = "sudahBeriTahu"
  private const val AMBANG = "ambangDetik"

  /** 10 menit, menyamai JEDA_OFFLINE_MENIT di connectivity.ts kalau JS belum sempat bicara. */
  private const val AMBANG_BAWAAN = 600

  private fun pref(ctx: Context) = ctx.getSharedPreferences(NAMA, Context.MODE_PRIVATE)

  fun simpanAmbang(ctx: Context, detik: Int) =
    pref(ctx).edit().putInt(AMBANG, detik).apply()

  fun ambangMs(ctx: Context): Long =
    pref(ctx).getInt(AMBANG, AMBANG_BAWAAN).toLong() * 1000L

  /** Awal episode offline yang sedang berjalan, atau null kalau belum ada. */
  fun sejak(ctx: Context): Long? =
    pref(ctx).getLong(SEJAK, 0L).takeIf { it > 0L }

  fun mulaiEpisode(ctx: Context, now: Long) =
    pref(ctx).edit().putLong(SEJAK, now).putBoolean(SUDAH_BERI_TAHU, false).apply()

  fun sudahBeriTahu(ctx: Context): Boolean = pref(ctx).getBoolean(SUDAH_BERI_TAHU, false)

  fun tandaiSudahBeriTahu(ctx: Context) =
    pref(ctx).edit().putBoolean(SUDAH_BERI_TAHU, true).apply()

  /** Ambangnya sengaja dipertahankan: yang selesai adalah episodenya, bukan setelannya. */
  fun bersihkan(ctx: Context) =
    pref(ctx).edit().remove(SEJAK).remove(SUDAH_BERI_TAHU).apply()
}
