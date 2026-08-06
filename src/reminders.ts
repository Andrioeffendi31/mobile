import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Bootstrap } from "@/api";
import { usePrefs } from "@/prefs";

/**
 * The clock-in / clock-out alarm.
 *
 * Scheduled on the phone rather than pushed from the server, for three reasons:
 * there is no cron anywhere in this stack to hang a 07:00 job off; a local
 * notification fires with no signal, which is exactly the moment somebody is
 * walking into a basement car park; and the times are already on the device — the
 * bootstrap carries the employee's own division shift.
 *
 * Ten requests, Monday to Friday × in/out. The identifiers are deterministic, so
 * cancelling needs nothing persisted and re-running this function is idempotent.
 */

/** expo numbers weekdays 1–7 with Sunday = 1, so Mon–Fri is 2–6. */
const WEEKDAYS = [2, 3, 4, 5, 6] as const;
const KINDS = ["in", "out"] as const;

const idFor = (kind: (typeof KINDS)[number], weekday: number) =>
  `absen-${kind}-${weekday}`;

const ALL_IDS = WEEKDAYS.flatMap((d) => KINDS.map((k) => idFor(k, d)));

const CHANNEL = "absen";

/**
 * A channel of its own, at HIGH importance with a vibration pattern — a punch
 * reminder that arrives silently in the shade is not a reminder. The ordinary
 * "default" channel stays where it is, at DEFAULT importance, so approval news
 * does not start buzzing too.
 *
 * Created at runtime, which is plain JS and therefore ships over the air; only a
 * custom sound *file* would need a native rebuild, and the system tone is the one
 * people already recognise as "your phone wants something".
 *
 * Android freezes a channel's settings the moment it is first created — the user
 * owns them after that. Getting importance or vibration wrong here cannot be
 * fixed by editing this object; it would need a new channel id.
 */
async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Pengingat absen",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#4f46e5",
  });
}

/**
 * Bring the scheduled reminders in line with the current shift, preference and
 * punch state.
 *
 * Cancel-everything-then-reschedule rather than diffing: a shift changed by HR, a
 * switch turned off, and "already clocked in today" then all fall out of one code
 * path with nothing to keep in sync.
 *
 * What it cannot know: national holidays and cuti bersama (that calendar lives in
 * the database, and five weekly triggers cannot say "except 17 Agustus"), an
 * approved leave day, or a shift changed while the app is never opened. Rebooting
 * is fine — expo-notifications re-registers on boot.
 */
export async function syncReminders(me: Bootstrap | undefined) {
  await Promise.all(
    ALL_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );

  if (!usePrefs.getState().reminder || !me) return;

  // never prompt from here: the switch is off by default, so reaching this line
  // means somebody asked for it, and if they refuse the OS dialog the switch stays
  // on but silent — which registerForPush already explains on the settings screen
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) {
    const asked = await Notifications.requestPermissionsAsync();
    if (!asked.granted) return;
  }
  await ensureChannel();

  const todayWeekday = new Date().getDay() + 1; // JS 0=Sun → expo 1=Sun

  for (const weekday of WEEKDAYS) {
    for (const kind of KINDS) {
      // Skipping today's slot also skips next week's, because a WEEKLY trigger is
      // the only thing holding it. The next app open restores it, and every punch
      // invalidates ["me"], so in practice that is the same minute.
      const done = kind === "in" ? me.today.clockIn : me.today.clockOut;
      if (weekday === todayWeekday && done) continue;

      const [h, m] = (kind === "in" ? me.shift.start : me.shift.end).split(":");
      await Notifications.scheduleNotificationAsync({
        identifier: idFor(kind, weekday),
        content: {
          title: kind === "in" ? "Waktunya absen masuk" : "Waktunya absen keluar",
          body:
            kind === "in"
              ? `Shift Anda mulai ${h}:${m}. Ketuk untuk absen sekarang.`
              : `Shift Anda selesai ${h}:${m}. Jangan lupa absen keluar.`,
          // the tab layout routes on this, same as a server push
          data: { route: "/absen" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: Number(h),
          minute: Number(m),
          channelId: CHANNEL,
        },
      });
    }
  }
}
