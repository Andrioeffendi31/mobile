import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Sheet, Text, XStack, YStack } from "tamagui";
import { postJson } from "@/api";
import { DateInput, TimeInput } from "@/date-input";
import { durasiJam, hariKerjaPreview, menitAntara, plusHari, todayWib } from "@/format";
import { toast } from "@/toast";
import { Btn, Field, Note, Readout, TextArea } from "@/ui";

/**
 * The two request forms (PRD-Mobile §6.3).
 *
 * Every number shown here is a *preview*: working days ignore the holiday table
 * the server has, and the balance/weekly-cap checks only happen in
 * POST /api/me/requests. So the button is enabled on shape alone (dates make
 * sense, reason long enough) and a rejected rule comes back as a message —
 * duplicating the rules here is how web and mobile drift apart (§10).
 */

const LEAVE_TYPES = [
  { value: "Cuti Tahunan", note: "Memotong saldo cuti tahunan" },
  { value: "Cuti Sakit", note: "Wajib lampirkan surat dokter ke HR" },
  { value: "Izin Khusus", note: "Tanpa memotong saldo cuti" },
] as const;

type LeaveType = (typeof LEAVE_TYPES)[number]["value"];

function SheetShell({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => !next && onClose()}
      snapPoints={[88]}
      dismissOnSnapToBottom
      transition="medium"
    >
      <Sheet.Overlay backgroundColor="rgba(20,22,27,.42)" />
      <Sheet.Handle />
      <Sheet.Frame
        backgroundColor="$surface"
        borderTopLeftRadius={22}
        borderTopRightRadius={22}
        paddingTop={12}
      >
        <Text fontSize={18} fontWeight="700" color="$fg" paddingHorizontal={22}>
          {title}
        </Text>
        <ScrollView
          contentContainerStyle={{ padding: 22, gap: 13 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        <XStack
          gap={10}
          paddingHorizontal={22}
          paddingTop={14}
          paddingBottom={26}
          borderTopWidth={1}
          borderTopColor="$line"
        >
          {footer}
        </XStack>
      </Sheet.Frame>
    </Sheet>
  );
}

export function LeaveSheet({
  open,
  onClose,
  delegates,
  remaining,
}: {
  open: boolean;
  onClose: () => void;
  delegates: { id: number; name: string }[];
  remaining: number;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<LeaveType>("Cuti Tahunan");
  const [start, setStart] = useState(plusHari(1));
  const [end, setEnd] = useState(plusHari(1));
  const [reason, setReason] = useState("");
  const [delegateId, setDelegateId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setType("Cuti Tahunan");
    setStart(plusHari(1));
    setEnd(plusHari(1));
    setReason("");
    setDelegateId(null);
  }, [open]);

  // keep the range coherent while typing rather than rejecting it on submit
  useEffect(() => {
    if (end < start) setEnd(start);
  }, [start, end]);

  const days = hariKerjaPreview(start, end);
  const invalid = days < 1 || reason.trim().length < 5;

  const submit = useMutation({
    mutationFn: () =>
      postJson<{ days: number }>("/api/me/requests", {
        kind: "cuti",
        type,
        startDate: start,
        endDate: end,
        reason: reason.trim(),
        ...(delegateId ? { delegateId } : {}),
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries();
      onClose();
      toast(`Pengajuan cuti ${res.days} hari kerja terkirim`);
    },
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title="Ajukan Cuti"
      footer={
        <>
          <Btn tone="ghost" width={46} onPress={onClose}>
            ✕
          </Btn>
          <Btn flex={1} disabled={invalid || submit.isPending} onPress={() => submit.mutate()}>
            {submit.isPending ? "Mengirim…" : "Kirim pengajuan"}
          </Btn>
        </>
      }
    >
      <Field label="Jenis cuti">
        <YStack gap={7}>
          {LEAVE_TYPES.map((t) => {
            const on = t.value === type;
            return (
              <XStack
                key={t.value}
                alignItems="center"
                gap={11}
                paddingHorizontal={13}
                paddingVertical={11}
                borderRadius={11}
                borderWidth={1}
                borderColor={on ? "$accent" : "$lineStrong"}
                backgroundColor={on ? "$accentSubtle" : "$surface"}
                onPress={() => setType(t.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <YStack
                  width={16}
                  height={16}
                  borderRadius={8}
                  borderWidth={5}
                  borderColor={on ? "$accent" : "$lineStrong"}
                  backgroundColor="$surface"
                />
                <YStack flex={1}>
                  <Text fontSize={13} fontWeight="500" color="$fg">
                    {t.value}
                  </Text>
                  <Text fontSize={11.5} color="$fgSubtle">
                    {t.value === "Cuti Tahunan" ? `${t.note} · sisa ${remaining} hari` : t.note}
                  </Text>
                </YStack>
              </XStack>
            );
          })}
        </YStack>
      </Field>

      <XStack gap={10}>
        <YStack flex={1}>
          <Field label="Mulai">
            <DateInput value={start} onChange={setStart} minimumDate={new Date()} />
          </Field>
        </YStack>
        <YStack flex={1}>
          <Field label="Selesai">
            <DateInput
              value={end}
              onChange={setEnd}
              minimumDate={new Date(`${start}T00:00:00`)}
            />
          </Field>
        </YStack>
      </XStack>

      <Readout
        label="Perkiraan durasi (hari libur nasional dihitung server)"
        value={`${days} hari kerja`}
      />

      <Field label="Alasan">
        <TextArea
          value={reason}
          onChangeText={setReason}
          placeholder="Tuliskan alasan pengajuan…"
          multiline
        />
      </Field>

      <Field label="Pengganti selama cuti (opsional)">
        <XStack gap={7} flexWrap="wrap">
          <Pill label="Tidak ada" on={delegateId === null} onPress={() => setDelegateId(null)} />
          {delegates.map((d) => (
            <Pill
              key={d.id}
              label={d.name}
              on={delegateId === d.id}
              onPress={() => setDelegateId(d.id)}
            />
          ))}
        </XStack>
      </Field>

      {submit.isError ? (
        <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
      ) : null}
    </SheetShell>
  );
}

export function OvertimeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayWib());
  const [startTime, setStartTime] = useState("17:30");
  const [endTime, setEndTime] = useState("20:30");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(todayWib());
    setStartTime("17:30");
    setEndTime("20:30");
    setReason("");
  }, [open]);

  const minutes = menitAntara(startTime, endTime);
  const invalid = minutes < 30 || reason.trim().length < 5;

  const submit = useMutation({
    mutationFn: () =>
      postJson("/api/me/requests", {
        kind: "lembur",
        date,
        startTime,
        endTime,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      onClose();
      toast("Pengajuan lembur terkirim");
    },
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title="Ajukan Lembur"
      footer={
        <>
          <Btn tone="ghost" width={46} onPress={onClose}>
            ✕
          </Btn>
          <Btn flex={1} disabled={invalid || submit.isPending} onPress={() => submit.mutate()}>
            {submit.isPending ? "Mengirim…" : "Kirim pengajuan"}
          </Btn>
        </>
      }
    >
      <Field label="Tanggal lembur">
        <DateInput value={date} onChange={setDate} />
      </Field>

      <XStack gap={10}>
        <YStack flex={1}>
          <Field label="Jam mulai">
            <TimeInput value={startTime} onChange={setStartTime} />
          </Field>
        </YStack>
        <YStack flex={1}>
          <Field label="Jam selesai">
            <TimeInput value={endTime} onChange={setEndTime} />
          </Field>
        </YStack>
      </XStack>

      {/* No wage estimate: this app records presence, not payroll. */}
      <Readout label="Durasi terhitung" value={durasiJam(minutes)} />

      <Field label="Alasan lembur">
        <TextArea
          value={reason}
          onChangeText={setReason}
          placeholder="Contoh: perbaikan bug rilis"
          multiline
        />
      </Field>

      <Note
        text="Lembur wajib disetujui HR sebelum dijalankan agar dapat dihitung. Batas 14 jam per minggu."
        fg="$warning"
        bg="$warningSubtle"
      />

      {submit.isError ? (
        <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
      ) : null}
    </SheetShell>
  );
}

function Pill({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <XStack
      height={32}
      paddingHorizontal={12}
      borderRadius={20}
      borderWidth={1}
      alignItems="center"
      borderColor={on ? "$accent" : "$lineStrong"}
      backgroundColor={on ? "$accentSubtle" : "$surface"}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text fontSize={12.5} color={on ? "$accent" : "$fgMuted"}>
        {label}
      </Text>
    </XStack>
  );
}
