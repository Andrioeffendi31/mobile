package app.nanumhr.pengawas

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Jembatan JS → JobScheduler. Sengaja setipis mungkin: seluruh keputusan ada di
 * [PengawasJaringanJob], yang harus bisa mengambilnya tanpa satu baris JS pun
 * berjalan.
 */
class PengawasJaringanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PengawasJaringan")

    Function("pasang") { ambangDetik: Int ->
      appContext.reactContext?.let { ctx ->
        Penanda.simpanAmbang(ctx, ambangDetik)
        jadwalkan(ctx)
      }
    }

    Function("lepas") {
      appContext.reactContext?.let { ctx ->
        penjadwal(ctx).cancel(JOB_ID)
        Penanda.bersihkan(ctx)
      }
    }

    Function("tandaiPulih") {
      appContext.reactContext?.let { ctx -> Penanda.bersihkan(ctx) }
    }
  }

  private fun penjadwal(ctx: Context) =
    ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler

  /**
   * Satu job periodik, persisted, **tanpa** `setRequiredNetworkType`.
   *
   * Itu satu-satunya baris yang membedakannya dari watchdog `expo-background-task`
   * yang sudah ada, dan sekaligus seluruh alasan modul ini ada: work request milik
   * paket itu mensyaratkan jaringan menyala, jadi ia tidak pernah berjalan pada
   * keadaan yang justru ingin dilaporkan.
   *
   * 15 menit adalah lantai `JobScheduler` untuk job periodik; meminta lebih cepat
   * hanya membuat sistem diam-diam membulatkannya ke atas. Jadi deteksi di luar jam
   * kerja bergranularitas ~15 menit, bukan seketika — yang seketika hanya terjadi
   * selama proses hidup, yaitu selama clock in.
   *
   * `setPersisted` menuntut RECEIVE_BOOT_COMPLETED, yang sudah dideklarasikan di
   * app.json. Tanpanya penjadwalannya melempar, bukan gagal diam-diam.
   */
  private fun jadwalkan(ctx: Context) {
    // Sudah terjadwal → jangan disentuh. `schedule()` dengan id yang sama MENGGANTI
    // job lamanya, dan penggantian itu memulai ulang hitungan periodenya dari nol.
    // Karena pemanggilnya adalah startConnectivityMonitor — yang jalan di tiap
    // peluncuran — menjadwalkan tanpa syarat berarti telepon yang dibuka tiap
    // sepuluh menit tidak akan pernah membiarkan job-nya sampai ke menit ke-15.
    if (penjadwal(ctx).getPendingJob(JOB_ID) != null) return

    val job =
      JobInfo.Builder(JOB_ID, ComponentName(ctx, PengawasJaringanJob::class.java))
        .setPersisted(true)
        .setRequiresDeviceIdle(false)
        .setRequiresCharging(false)
        .setPeriodic(PERIODE_MS)
        .build()
    penjadwal(ctx).schedule(job)
  }

  companion object {
    /** Angka tetap milik kami sendiri; JobScheduler membiarkan job dengan id sama menimpa. */
    private const val JOB_ID = 771_201
    private const val PERIODE_MS = 15L * 60L * 1000L
  }
}
