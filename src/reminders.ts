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

/** Last schedule applied in this JS process. Bootstrap invalidations often
 * return a fresh object with identical reminder inputs; native work is only
 * needed when one of those inputs really changed. */
let lastSignature: string | null = null;

/**
 * Bumped from "absen": the settings below (HIGH, two buzzes, system tone) were
 * already written that way, but Android froze the original channel at whatever
 * it was first created with, so every install that had already seen it kept the
 * old behaviour. A new id is the only way to re-state them.
 */
const CHANNEL = "absen-v2";
const CHANNEL_LAMA = "absen";

/**
 * How early the alarm goes off. A reminder that arrives *at* the shift start is
 * already late — the point is the quarter hour somebody still has to park, walk
 * in and open the app.
 *
 * Exported so the settings screen states the same number; two places writing
 * "10 menit" by hand is how a note ends up lying about the alarm.
 */
export const LEAD_MINUTES = 15;

/**
 * The shift time moved back by the lead, as a weekly trigger's fields.
 *
 * The wrap matters for a shift that starts inside the first ten minutes of the
 * day: 00:05 minus the lead is 23:55 *the day before*, so the trigger's weekday
 * moves back with it. Expo numbers weekdays 1–7 with Sunday = 1, hence the
 * `((w + 5) % 7) + 1` rather than `w - 1`.
 */
function alarmAt(time: string, weekday: number) {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m - LEAD_MINUTES;
  const wrapped = minutes < 0;
  const total = wrapped ? minutes + 24 * 60 : minutes;

  return {
    weekday: wrapped ? ((weekday + 5) % 7) + 1 : weekday,
    hour: Math.floor(total / 60),
    minute: total % 60,
  };
}

if (__DEV__) {
  const eq = (got: object, want: object) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`alarmAt: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    }
  };
  eq(alarmAt("08:00", 2), { weekday: 2, hour: 7, minute: 45 });
  eq(alarmAt("17:05", 6), { weekday: 6, hour: 16, minute: 50 });
  eq(alarmAt("00:05", 2), { weekday: 1, hour: 23, minute: 50 }); // Monday shift, Sunday alarm
  eq(alarmAt("00:00", 1), { weekday: 7, hour: 23, minute: 45 }); // Sunday wraps to Saturday
}

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
 * fixed by editing this object; it needs a new channel id, which is what
 * CHANNEL_LAMA is a gravestone for.
 */
async function ensureChannel() {
  if (Platform.OS !== "android") return;
  // otherwise the dead channel sits in the app's notification settings forever,
  // one line above its replacement and with the same name
  await Notifications.deleteNotificationChannelAsync(CHANNEL_LAMA).catch(() => {});
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Pengingat absen",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    // getar–jeda–getar: dua denyut, bukan satu getaran panjang
    vibrationPattern: [0, 400, 250, 400],
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
  // The tab layout renders once before bootstrap exists. Previously that empty
  // render still fired ten native cancellation calls during the busiest part of
  // cold start, then repeated all ten when /api/me completed.
  if (!me) return;

  const enabled = usePrefs.getState().reminder;
  const signature = enabled
    ? [
        "on",
        me.today.date,
        me.today.clockIn ?? "",
        me.today.clockOut ?? "",
        me.shift.start,
        me.shift.end,
      ].join("|")
    : "off";
  if (signature === lastSignature) return;

  // Off is the persisted default. On a fresh process there is nothing new to
  // apply; reminders were already cancelled when the switch changed to off.
  if (!enabled && lastSignature === null) {
    lastSignature = signature;
    return;
  }

  // Keep bridge pressure predictable on lower-end Android devices. Reminder
  // maintenance is background work; completing a few ms later is harmless.
  for (const id of ALL_IDS) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }

  if (!enabled) {
    lastSignature = signature;
    return;
  }

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

      const time = kind === "in" ? me.shift.start : me.shift.end;
      await Notifications.scheduleNotificationAsync({
        identifier: idFor(kind, weekday),
        content: {
          title:
            kind === "in"
              ? `${LEAD_MINUTES} menit lagi absen masuk`
              : `${LEAD_MINUTES} menit lagi absen keluar`,
          body:
            kind === "in"
              ? `Shift Anda mulai ${time}. Ketuk untuk absen sekarang.`
              : `Shift Anda selesai ${time}. Jangan lupa absen keluar.`,
          // Android takes the tone from the channel; iOS has no channels and
          // stays silent unless the content asks for one.
          sound: "default",
          // the tab layout routes on this, same as a server push
          data: { route: "/absen" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          ...alarmAt(time, weekday),
          channelId: CHANNEL,
        },
      });
    }
  }
  lastSignature = signature;
}
