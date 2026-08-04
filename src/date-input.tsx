import { useState } from "react";
import { Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { XStack } from "tamagui";
import { tint } from "@/theme";
import { Mono } from "@/ui";

/**
 * Date and time fields for the request forms.
 *
 * The mockup uses `<input type="date">`, whose mobile equivalent is the OS
 * picker — so this wraps @react-native-community/datetimepicker rather than ask
 * anybody to type "2026-09-01" on a phone keyboard. The value stays a plain
 * YYYY-MM-DD / HH:MM string, which is what the API takes.
 */

function Trigger({
  text,
  icon,
  onPress,
}: {
  text: string;
  icon: "calendar" | "clock";
  onPress: () => void;
}) {
  return (
    <XStack
      height={42}
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={13}
      borderWidth={1}
      borderColor="$lineStrong"
      borderRadius={11}
      backgroundColor="$surface"
      pressStyle={{ backgroundColor: "$inset" }}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Mono fontSize={13}>{text}</Mono>
      <Feather name={icon} size={15} color={tint("$fgSubtle")} />
    </XStack>
  );
}

/** Local date parts, not UTC: the picker hands back a local Date, and
 *  toISOString() on it would roll the day backwards west of Greenwich. */
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function DateInput({
  value,
  onChange,
  minimumDate,
}: {
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Trigger text={value} icon="calendar" onPress={() => setOpen(true)} />
      {open ? (
        <DateTimePicker
          mode="date"
          display="default"
          value={new Date(`${value}T00:00:00`)}
          minimumDate={minimumDate}
          onChange={(event, picked) => {
            setOpen(false);
            if (event.type === "dismissed" || !picked) return;
            onChange(isoLocal(picked));
          }}
        />
      ) : null}
    </>
  );
}

export function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [h, m] = value.split(":").map(Number);
  const asDate = new Date();
  asDate.setHours(h || 0, m || 0, 0, 0);

  return (
    <>
      <Trigger text={value} icon="clock" onPress={() => setOpen(true)} />
      {open ? (
        <DateTimePicker
          mode="time"
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          value={asDate}
          onChange={(event, picked) => {
            setOpen(false);
            if (event.type === "dismissed" || !picked) return;
            onChange(hhmm(picked));
          }}
        />
      ) : null}
    </>
  );
}
