package app.nanumhr.pengawas

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Context
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Pemeriksa koneksi yang berjalan tanpa satu baris JS pun.
 *
 * Seluruh keputusan diambil di sini, di `onStartJob`, lalu selesai — tidak ada
 * `jobFinished(params, true)`, tidak ada kerja asinkron, tidak ada bundel JS yang
 * dibangunkan. Membangunkan JS akan mengalahkan tujuannya: yang dibutuhkan justru
 * jalur yang tidak bergantung pada apa pun milik React.
 */
class PengawasJaringanJob : JobService() {
  override fun onStartJob(params: JobParameters?): Boolean {
    try {
      periksa(applicationContext)
    } catch (_: Throwable) {
      // Job yang melempar akan dianggap gagal dan bisa membuat sistem menghentikan
      // penjadwalannya. Diam lebih baik daripada kehilangan seluruh pengawasnya.
    }
    // false = sudah selesai di thread ini. Pemeriksaannya hanya membaca
    // ConnectivityManager dan SharedPreferences; keduanya tidak memblokir.
    return false
  }

  /** Job periodik akan dijadwalkan ulang sendiri oleh sistem; tidak ada yang perlu diulang. */
  override fun onStopJob(params: JobParameters?): Boolean = false

  private fun periksa(ctx: Context) {
    val now = System.currentTimeMillis()

    if (!offline(ctx)) {
      // Pulih sebelum ambang berarti tidak ada yang perlu diberitahukan sama sekali,
      // dan yang sudah tampil ikut disingkirkan — memberi tahu "internet terputus"
      // untuk keadaan yang sudah selesai lebih buruk daripada tidak memberi tahu.
      Penanda.bersihkan(ctx)
      NotificationManagerCompat.from(ctx).cancel(NOTIF_TAG, NOTIF_ID)
      return
    }

    val sejak = Penanda.sejak(ctx)
    if (sejak == null) {
      // Tik pertama yang melihat putusnya: catat awalnya, jangan langsung berbunyi.
      // Lift dan basement tidak boleh menghasilkan notifikasi apa pun.
      Penanda.mulaiEpisode(ctx, now)
      return
    }
    if (Penanda.sudahBeriTahu(ctx)) return
    if (now - sejak < Penanda.ambangMs(ctx)) return

    beriTahu(ctx)
    Penanda.tandaiSudahBeriTahu(ctx)
  }

  /**
   * Benar-benar tidak ada internet, bukan sekadar "ada antarmuka menyala".
   * `NET_CAPABILITY_VALIDATED` yang membedakan wifi hotel yang belum di-login dari
   * wifi yang benar-benar bisa menghubungi server.
   */
  private fun offline(ctx: Context): Boolean {
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      ?: return false
    val kemampuan = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
    return !kemampuan.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
      !kemampuan.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }

  private fun beriTahu(ctx: Context) {
    if (!bolehBeriTahu(ctx)) return
    pastikanChannel(ctx)

    val buka = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val tap = buka?.let {
      PendingIntent.getActivity(
        ctx,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val notif = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle("Internet terputus")
      .setContentText(
        "NanumHR mendeteksi perangkat sedang offline. Beberapa data akan menunggu koneksi kembali.",
      )
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .apply { tap?.let { setContentIntent(it) } }
      .build()

    // Tag dan id yang sama persis dengan yang dipakai expo-notifications untuk
    // identifier "nanumhr-offline" (ia memanggil notify(identifier, 0, ...)).
    // Karena itu notifikasi native ini MENGGANTI milik JS alih-alih menumpuk, dan
    // `dismissNotificationAsync("nanumhr-offline")` di markInternetConnected ikut
    // menyingkirkannya. Dua penjaga, satu baris di shade.
    NotificationManagerCompat.from(ctx).notify(NOTIF_TAG, NOTIF_ID, notif)
  }

  private fun bolehBeriTahu(ctx: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
    } else {
      NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    }

  /**
   * Setelannya disalin PERSIS dari `ensureChannel()` di connectivity.ts — nama,
   * importance, getaran, warna. Android membekukan setelan sebuah channel pada saat
   * ia pertama kali dibuat, jadi siapa pun di antara kedua pihak yang menang duluan
   * harus menghasilkan channel yang sama; berbeda sedikit saja berarti setelan yang
   * satunya menjadi hiasan belaka.
   */
  private fun pastikanChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Status koneksi", NotificationManager.IMPORTANCE_HIGH)
    channel.enableVibration(true)
    channel.vibrationPattern = longArrayOf(0, 350, 180, 350)
    channel.enableLights(true)
    channel.lightColor = Color.parseColor("#f59e0b")
    nm.createNotificationChannel(channel)
  }

  private companion object {
    const val CHANNEL = "connectivity"
    const val NOTIF_TAG = "nanumhr-offline"
    const val NOTIF_ID = 0
  }
}
