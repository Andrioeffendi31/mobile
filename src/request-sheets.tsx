import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { Feather } from "@expo/vector-icons";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { tint } from "@/theme";
import { API, type RequestItem, get, postForm, postJson } from "@/api";
import { DateInput, TimeInput } from "@/date-input";
import { durasiJam, hariKerjaPreview, menitAntara, plusHari, tanggalPanjang, todayWib } from "@/format";
import { toast } from "@/toast";
import { Btn, Field, Note, Readout, ReqBadge, SheetShell, TextArea } from "@/ui";

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
  {
    value: "Izin Setengah Hari",
    note: "Beberapa jam pada satu hari · tidak dihitung terlambat",
  },
] as const;

type LeaveType = (typeof LEAVE_TYPES)[number]["value"];

export function LeaveSheet({
  open,
  onClose,
  delegates,
  remaining,
  request,
}: {
  open: boolean;
  onClose: () => void;
  delegates: { id: number; name: string }[];
  remaining: number;
  /** the request this sheet is showing — absent when filing a new one */
  request?: RequestItem | null;
}) {
  /**
   * Boleh disunting hanya sebelum ada tanda tangan sama sekali.
   *
   * Sesudah admin menyetujui (`menunggu_pimpinan`), menyunting isinya akan membuang
   * persetujuan yang sudah diberikan tanpa ada yang tahu — jadi yang tersisa
   * hanyalah membatalkan, dan itu ditangani `bisaBatal` di bawah.
   */
  const editable = request
    ? request.status === "menunggu" || request.status === "revisi"
    : true;
  /** the values are prefilled in every mode; only `editable` decides if they move */
  /**
   * Dibatalkan boleh sampai keputusan akhir — termasuk saat sudah menunggu
   * Pimpinan. Itu cuti miliknya sendiri; yang tidak boleh adalah MENYUNTINGnya
   * sesudah ada yang menandatangani.
   */
  const bisaBatal = Boolean(
    request &&
      (request.status === "menunggu" ||
        request.status === "revisi" ||
        request.status === "menunggu_pimpinan"),
  );
  const edit = request && editable ? request : null;
  const qc = useQueryClient();
  const [type, setType] = useState<LeaveType>("Cuti Tahunan");
  const [start, setStart] = useState(plusHari(1));
  const [end, setEnd] = useState(plusHari(1));
  const [reason, setReason] = useState("");
  /** jam izin — hanya dipakai jenis "Izin Setengah Hari" */
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [delegateId, setDelegateId] = useState<number | null>(null);
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  /** the attachment already on the server: kept, replaced, or explicitly dropped */
  const [keptAttachment, setKeptAttachment] = useState<RequestItem["attachment"]>(null);

  // prefilled from the request being revised, or reset to a blank form — either
  // way per opening, so yesterday's draft never resurfaces
  useEffect(() => {
    if (!open) return;
    setType((request?.type as LeaveType) ?? "Cuti Tahunan");
    setStart(request?.startDate ?? plusHari(1));
    setEnd(request?.endDate ?? plusHari(1));
    setReason(request?.reason ?? "");
    setStartTime(request?.startTime ?? "08:00");
    setEndTime(request?.endTime ?? "12:00");
    setDelegateId(request?.delegateId ?? null);
    setFile(null);
    setKeptAttachment(request?.attachment ?? null);
  }, [open, request]);

  // keep the range coherent while typing rather than rejecting it on submit —
  // never while merely looking at a request, whose dates are history
  useEffect(() => {
    if (editable && end < start) setEnd(start);
  }, [editable, start, end]);

  /**
   * Izin setengah hari itu satu tanggal dan dua jam: rentang tanggalnya dikunci
   * ke satu hari (server juga menolak yang lain), dan yang divalidasi adalah
   * jamnya. Angka di sini tetap sekadar pratinjau — aturannya ada di
   * /api/me/requests, termasuk penolakan izin yang menutup seluruh shift.
   */
  const setengahHari = type === "Izin Setengah Hari";
  useEffect(() => {
    if (editable && setengahHari && end !== start) setEnd(start);
  }, [editable, setengahHari, start, end]);

  const days = hariKerjaPreview(start, end);
  const menitIzin = menitAntara(startTime, endTime);
  const invalid =
    reason.trim().length < 5 ||
    (setengahHari ? endTime <= startTime : days < 1);

  /** cancelling lives with the form because the form is where a request is now
   *  opened from — one place holds every action on a pengajuan */
  const cancel = useMutation({
    mutationFn: () =>
      postJson("/api/me/requests", { kind: "cuti", id: request?.id }, "PATCH"),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["requests"] }),
        qc.invalidateQueries({ queryKey: ["me"], refetchType: "none" }),
      ]);
      onClose();
      toast("Pengajuan dibatalkan");
    },
    onError: (e) => toast((e as Error).message),
  });

  /**
   * Multipart either way, because the form can carry a file — and the server reads
   * JSON or multipart from the same schema, so there is no second shape to keep in
   * sync. PUT resubmits a revision, POST files a new request.
   */
  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("kind", "cuti");
      form.append("type", type);
      form.append("startDate", start);
      form.append("endDate", end);
      form.append("reason", reason.trim());
      if (setengahHari) {
        form.append("startTime", startTime);
        form.append("endTime", endTime);
      }
      if (delegateId) form.append("delegateId", String(delegateId));
      if (file) {
        form.append("attachment", {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? "application/octet-stream",
        } as unknown as Blob);
      }
      if (!edit) return postForm<{ days: number }>("/api/me/requests", form);

      form.append("id", String(edit.id));
      // the server keeps the existing file unless told otherwise, so removal has
      // to be stated rather than inferred from an absent part
      if (!file && !keptAttachment) form.append("removeAttachment", "1");
      return postForm<{ days: number }>("/api/me/requests", form, "PUT");
    },
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["requests"] }),
        qc.invalidateQueries({ queryKey: ["me"], refetchType: "none" }),
      ]);
      onClose();
      toast(
        setengahHari
          ? `Izin ${startTime}–${endTime} terkirim`
          : edit
            ? `Revisi terkirim · ${res.days} hari kerja`
            : `Pengajuan cuti ${res.days} hari kerja terkirim`,
      );
    },
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={!request ? "Ajukan cuti" : editable ? "Perbaiki pengajuan" : request.title}
      /**
       * No back button: the sheet already closes by its handle, by dragging down,
       * and by tapping the overlay — a fourth way to leave was taking width from
       * the two things there are to decide.
       *
       * A decided request gets "Tutup" instead of a disabled status label; the
       * badge at the top of the sheet already says what was decided, so the footer
       * only needs a way out.
       */
      footer={
        editable ? (
          <>
            <Btn flex={1} disabled={invalid || submit.isPending} onPress={() => submit.mutate()}>
              {submit.isPending
                ? "Mengirim…"
                : request?.status === "revisi"
                  ? "Kirim revisi"
                  : request
                    ? "Simpan perubahan"
                    : "Kirim pengajuan"}
            </Btn>
            {request ? (
              <Btn
                tone="danger"
                disabled={cancel.isPending}
                onPress={() => cancel.mutate()}
                aria-label="Batalkan pengajuan"
              >
                {cancel.isPending ? "…" : "Batalkan"}
              </Btn>
            ) : null}
          </>
        ) : bisaBatal ? (
          // sudah lolos admin: isinya terkunci, tapi membatalkan masih haknya
          <Btn
            flex={1}
            tone="danger"
            disabled={cancel.isPending}
            onPress={() => cancel.mutate()}
          >
            {cancel.isPending ? "Membatalkan…" : "Batalkan pengajuan"}
          </Btn>
        ) : (
          <Btn flex={1} tone="ghost" onPress={onClose}>
            Tutup
          </Btn>
        )
      }
    >
      {request ? (
        <>
          <XStack alignItems="center" gap={7} flexWrap="wrap">
            <ReqBadge status={request.status} />
            {request.createdAt ? (
              <Text fontSize={11.5} color="$fgSubtle">
                diajukan {tanggalPanjang(request.createdAt.slice(0, 10))}
              </Text>
            ) : null}
            <Text fontSize={11.5} color="$fgSubtle">
              · {request.detail}
            </Text>
          </XStack>
          {request.note ? (
            <Note
              text={
                request.status === "revisi"
                  ? `HR meminta revisi: ${request.note}`
                  : request.note
              }
              fg={request.status === "revisi" ? "$accent" : "$fgMuted"}
              bg={request.status === "revisi" ? "$accentSubtle" : "$inset"}
            />
          ) : null}
        </>
      ) : null}

      <Field label="Jenis cuti">
        <YStack borderRadius={20} overflow="hidden" borderWidth={1} borderColor="$line">
          {LEAVE_TYPES.map((t, index) => {
            const on = t.value === type;
            return (
              <XStack
                key={t.value}
                minHeight={64}
                alignItems="center"
                gap={11}
                paddingHorizontal={13}
                paddingVertical={9}
                borderBottomWidth={index === LEAVE_TYPES.length - 1 ? 0 : 1}
                borderBottomColor="$line"
                backgroundColor={on ? "$accentSubtle" : "$surface"}
                // a decided request shows which type it was, it does not offer the
                // other two: dimming only the unselected rows keeps the answer legible
                opacity={editable || on ? 1 : 0.4}
                onPress={editable ? () => setType(t.value) : undefined}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !editable }}
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

      {/* Satu tanggal untuk izin berjam, dua untuk sisanya — kolom "Selesai"
          yang selalu sama dengan "Mulai" hanya menawarkan cara untuk salah. */}
      {setengahHari ? (
        <>
          <Field label="Tanggal izin">
            <DateInput
              value={start}
              onChange={setStart}
              minimumDate={new Date()}
              disabled={!editable}
            />
          </Field>
          <XStack gap={10}>
            <YStack flex={1}>
              <Field label="Izin dari jam">
                <TimeInput
                  value={startTime}
                  onChange={setStartTime}
                  disabled={!editable}
                />
              </Field>
            </YStack>
            <YStack flex={1}>
              <Field label="Sampai jam">
                <TimeInput
                  value={endTime}
                  onChange={setEndTime}
                  disabled={!editable}
                />
              </Field>
            </YStack>
          </XStack>
        </>
      ) : (
        <XStack gap={10}>
          <YStack flex={1}>
            <Field label="Mulai">
              <DateInput
                value={start}
                onChange={setStart}
                minimumDate={new Date()}
                disabled={!editable}
              />
            </Field>
          </YStack>
          <YStack flex={1}>
            <Field label="Selesai">
              <DateInput
                value={end}
                onChange={setEnd}
                minimumDate={new Date(`${start}T00:00:00`)}
                disabled={!editable}
              />
            </Field>
          </YStack>
        </XStack>
      )}

      {setengahHari ? (
        <Readout
          label="Absen masuk setelah jam izin tidak dihitung terlambat"
          value={endTime > startTime ? durasiJam(menitIzin) : "Jam belum benar"}
        />
      ) : (
        <Readout
          label="Perkiraan durasi (hari libur nasional dihitung server)"
          value={`${days} hari kerja`}
        />
      )}

      <Field label="Alasan">
        <TextArea
          value={reason}
          onChangeText={setReason}
          placeholder="Tuliskan alasan pengajuan…"
          multiline
          readOnly={!editable}
          backgroundColor={editable ? "$surface" : "$inset"}
        />
      </Field>

      {/* Surat izin PDF untuk dicetak.
          Servernya yang membuat PDF-nya, jadi di sini cukup membuka tautannya —
          tidak ada expo-print/expo-sharing, yang keduanya modul native dan akan
          MERUSAK pembaruan OTA di APK yang sudah terpasang (lihat ui.tsx).
          Tanpa `?json=1` seperti lampiran: rute suratnya diotorisasi token di
          path-nya, bukan cookie sesi, jadi browser sistem boleh membukanya
          langsung. Hanya untuk pengajuan yang sudah ada — draf belum punya
          nomor surat. */}
      {request?.suratToken ? (
        <Field label="Surat izin">
          <XStack
            alignItems="center"
            gap={10}
            paddingHorizontal={12}
            paddingVertical={11}
            borderRadius={11}
            borderWidth={1}
            borderColor="$lineStrong"
            pressStyle={{ backgroundColor: "$inset" }}
            onPress={() => {
              Linking.openURL(
                `${API}/api/surat/cuti/${request.suratToken}`,
              ).catch(() => toast("Tidak ada aplikasi untuk membuka PDF"));
            }}
            accessibilityRole="button"
            aria-label="Unduh surat izin PDF"
          >
            <Feather name="file-text" size={15} color={tint("$fgSubtle")} />
            <Text fontSize={12.5} color="$fg" flex={1}>
              Unduh surat izin (PDF)
            </Text>
            <Feather name="download" size={15} color={tint("$fgSubtle")} />
          </XStack>
        </Field>
      ) : null}

      <Field label="Lampiran (opsional)">
        <AttachmentPicker
          file={file}
          kept={keptAttachment}
          editable={editable}
          onPick={setFile}
          onClear={() => {
            setFile(null);
            setKeptAttachment(null);
          }}
        />
      </Field>

      <Field label="Pengganti selama cuti (opsional)">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <XStack gap={7} paddingRight={8}>
          {/* read-only: just the answer, not the alternatives nobody can pick */}
          {editable ? (
            <>
              <Pill
                label="Tidak ada"
                on={delegateId === null}
                onPress={() => setDelegateId(null)}
              />
              {delegates.map((d) => (
                <Pill
                  key={d.id}
                  label={d.name}
                  on={delegateId === d.id}
                  onPress={() => setDelegateId(d.id)}
                />
              ))}
            </>
          ) : (
            <Pill label={request?.delegateName ?? "Tidak ada"} on onPress={() => {}} />
          )}
          </XStack>
        </ScrollView>
      </Field>

      {submit.isError ? (
        <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
      ) : null}
    </SheetShell>
  );
}

/**
 * The same three modes as the leave sheet, minus editing: there is no endpoint to
 * revise overtime, because doing it properly means recounting the weekly cap while
 * excluding the row being changed — real logic, not a copied form. An open overtime
 * request is cancelled and refiled, so this reads as either a blank form or a
 * record.
 */
export function OvertimeSheet({
  open,
  onClose,
  request,
}: {
  open: boolean;
  onClose: () => void;
  request?: RequestItem | null;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayWib());
  const [startTime, setStartTime] = useState("17:30");
  const [endTime, setEndTime] = useState("20:30");
  const [reason, setReason] = useState("");

  const viewing = Boolean(request);
  // lembur satu tingkat, jadi tidak ada keadaan antara untuk dipertimbangkan
  const openState = request?.status === "menunggu" || request?.status === "revisi";

  const cancel = useMutation({
    mutationFn: () =>
      postJson("/api/me/requests", { kind: "lembur", id: request?.id }, "PATCH"),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["requests"] }),
        qc.invalidateQueries({ queryKey: ["me"], refetchType: "none" }),
      ]);
      onClose();
      toast("Pengajuan dibatalkan");
    },
    onError: (e) => toast((e as Error).message),
  });

  useEffect(() => {
    if (!open) return;
    setDate(request?.date ?? todayWib());
    setStartTime(request?.startTime ?? "17:30");
    setEndTime(request?.endTime ?? "20:30");
    setReason(request?.reason ?? "");
  }, [open, request]);

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
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["requests"] }),
        qc.invalidateQueries({ queryKey: ["me"], refetchType: "none" }),
      ]);
      onClose();
      toast("Pengajuan lembur terkirim");
    },
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={viewing ? (request!.title ?? "Lembur") : "Ajukan lembur"}
      /** same footer rules as the leave sheet — minus a submit, since overtime has
       *  no edit endpoint to submit to */
      footer={
        !viewing ? (
          <Btn flex={1} disabled={invalid || submit.isPending} onPress={() => submit.mutate()}>
            {submit.isPending ? "Mengirim…" : "Kirim pengajuan"}
          </Btn>
        ) : openState ? (
          <Btn
            flex={1}
            tone="danger"
            disabled={cancel.isPending}
            onPress={() => cancel.mutate()}
          >
            {cancel.isPending ? "Membatalkan…" : "Batalkan pengajuan"}
          </Btn>
        ) : (
          <Btn flex={1} tone="ghost" onPress={onClose}>
            Tutup
          </Btn>
        )
      }
    >
      {request ? (
        <>
          <XStack alignItems="center" gap={7} flexWrap="wrap">
            <ReqBadge status={request.status} />
            <Text fontSize={11.5} color="$fgSubtle">
              {request.detail}
            </Text>
          </XStack>
          {request.note ? <Note text={request.note} fg="$fgMuted" bg="$inset" /> : null}
        </>
      ) : null}

      <Field label="Tanggal lembur">
        <DateInput disabled={viewing} value={date} onChange={setDate} />
      </Field>

      <XStack gap={10}>
        <YStack flex={1}>
          <Field label="Jam mulai">
            <TimeInput disabled={viewing} value={startTime} onChange={setStartTime} />
          </Field>
        </YStack>
        <YStack flex={1}>
          <Field label="Jam selesai">
            <TimeInput disabled={viewing} value={endTime} onChange={setEndTime} />
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
          readOnly={viewing}
          backgroundColor={viewing ? "$inset" : "$surface"}
        />
      </Field>

      {viewing ? null : (
        <Note
          text="Lembur wajib disetujui HR sebelum dijalankan agar dapat dihitung. Batas 14 jam per minggu."
          fg="$warning"
          bg="$warningSubtle"
        />
      )}

      {submit.isError ? (
        <Note text={(submit.error as Error).message} fg="$danger" bg="$dangerSubtle" />
      ) : null}
    </SheetShell>
  );
}

/**
 * One optional file per leave request — a doctor's note, an invitation, a visa
 * letter. Three states in one row: nothing picked, a file already on the server
 * from the original submission, and a new file chosen to replace it.
 *
 * Kept to a single file because that is what every one of these processes needs;
 * the server stores it in three columns for the same reason.
 */
function AttachmentPicker({
  file,
  kept,
  editable,
  onPick,
  onClear,
}: {
  file: DocumentPicker.DocumentPickerAsset | null;
  kept: RequestItem["attachment"];
  editable: boolean;
  onPick: (f: DocumentPicker.DocumentPickerAsset) => void;
  onClear: () => void;
}) {
  /** the signed URL, then the browser — the session is a header this app holds,
   *  not a cookie the browser would send */
  const download = useMutation({
    mutationFn: async (key: string) => {
      const { url } = await get<{ url: string }>(`/api/files/${key}?json=1`);
      await Linking.openURL(url);
    },
    onError: (e) => toast((e as Error).message),
  });
  const pick = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!picked.canceled) onPick(picked.assets[0]);
  };

  const name = file?.name ?? kept?.name ?? null;

  // read-only: either the file that was filed, or nothing worth a row
  if (!editable) {
    if (!name || !kept) {
      return (
        <Text fontSize={12.5} color="$fgSubtle">
          Tidak ada lampiran
        </Text>
      );
    }
    return (
      <XStack
        alignItems="center"
        gap={10}
        paddingHorizontal={12}
        paddingVertical={11}
        borderRadius={11}
        borderWidth={1}
        borderColor="$lineStrong"
        pressStyle={{ backgroundColor: "$inset" }}
        onPress={() => download.mutate(kept.key)}
        accessibilityRole="button"
        aria-label={`Unduh lampiran ${name}`}
      >
        <Feather name="paperclip" size={15} color={tint("$fgSubtle")} />
        <Text fontSize={12.5} color="$fg" flex={1} numberOfLines={1}>
          {name}
        </Text>
        <Feather name="download" size={15} color={tint("$fgSubtle")} />
      </XStack>
    );
  }

  if (!name) {
    return (
      <XStack
        height={44}
        alignItems="center"
        justifyContent="center"
        gap={8}
        borderRadius={11}
        borderWidth={1}
        borderColor="$fgMuted"
        borderStyle="dashed"
        pressStyle={{ backgroundColor: "$inset" }}
        onPress={pick}
        accessibilityRole="button"
        aria-label="Pilih lampiran"
      >
        <Feather name="paperclip" size={15} color={tint("$fgSubtle")} />
        <Text fontSize={13} color="$fgMuted">
          Pilih berkas
        </Text>
      </XStack>
    );
  }

  return (
    <XStack
      alignItems="center"
      gap={10}
      paddingHorizontal={12}
      paddingVertical={10}
      borderRadius={11}
      borderWidth={1}
      borderColor="$accentLine"
      backgroundColor="$accentSubtle"
    >
      <Feather name="paperclip" size={15} color={tint("$accent")} />
      <YStack flex={1}>
        <Text fontSize={12.5} fontWeight="500" color="$fg" numberOfLines={1}>
          {name}
        </Text>
        <Text fontSize={11} color="$fgSubtle">
          {file ? "Berkas baru" : "Terlampir sebelumnya"} · ketuk ikon untuk ganti
        </Text>
      </YStack>
      <XStack
        width={30}
        height={30}
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.5 }}
        onPress={pick}
        accessibilityRole="button"
        aria-label="Ganti lampiran"
      >
        <Feather name="refresh-cw" size={14} color={tint("$fgSubtle")} />
      </XStack>
      <XStack
        width={30}
        height={30}
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.5 }}
        onPress={onClear}
        accessibilityRole="button"
        aria-label="Hapus lampiran"
      >
        <Feather name="x" size={15} color={tint("$danger")} />
      </XStack>
    </XStack>
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
      // same edge as the team filter Chip — $lineStrong was 1.43:1 on white
      borderColor={on ? "$accent" : "$fgSubtle"}
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
