import { useState } from "react";
import { useIsFocused, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type Bootstrap, get, postJson } from "@/api";
import { tanggalOrDash, telepon, umur } from "@/format";
import { toast } from "@/toast";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  ErrorNote,
  Field,
  Group,
  Input,
  PageHeader,
  Row,
  Screen,
  SheetShell,
  SkeletonRows,
} from "@/ui";

/**
 * "Profil saya" — the employee record as HR holds it.
 *
 * A page under Pengaturan rather than rows inside it, for the same reason as
 * Tentang: this is a record to read, while Pengaturan is a set of switches to
 * flip, and mixing the two made one long screen with no through-line.
 *
 * Almost all of it is read-only. Identity and employment data are HR's record of
 * you — an employee who can edit their own division picks their own shift — so
 * the only thing this screen writes is the four contact fields, which are the
 * ones that go stale and which HR has no way of noticing.
 */
export default function Profil() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => get<Bootstrap>("/api/me", { signal }),
    enabled: isFocused,
  });
  const [editing, setEditing] = useState(false);

  const p = me.data?.profile;
  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/pengaturan");

  return (
    <Screen>
      <PageHeader
        title="Profil saya"
        subtitle="Data kepegawaian dan kontak"
        onBack={back}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: 28,
          gap: 19,
        }}
      >
        {me.isError ? (
          <ErrorNote message="Gagal memuat profil." onRetry={() => me.refetch()} />
        ) : !p ? (
          <SkeletonRows count={6} />
        ) : (
          <>
            <Card padding={16} alignItems="center" gap={7}>
              <Avatar
                seed={p.id}
                initials={p.initials}
                photoKey={isFocused ? p.photoKey : null}
                size={62}
              />
              <YStack alignItems="center" gap={3}>
                <Text fontSize={16} fontWeight="700" color="$fg">
                  {p.name}
                </Text>
                <Text fontSize={12} color="$fgMuted">
                  {p.nik}
                  {p.position ? ` · ${p.position}` : ""}
                </Text>
              </YStack>
              <XStack gap={6} marginTop={2}>
                <Badge label="Aktif" fg="$success" bg="$successSubtle" />
                {p.division !== "Tanpa divisi" ? (
                  <Badge label={p.division} fg="$fgMuted" bg="$inset" />
                ) : null}
              </XStack>
            </Card>

            <Group label="Data pribadi">
              <Row
                label="Tempat lahir"
                value={p.birthPlace ?? "—"}
              />
              <Row label="Tanggal lahir" value={tanggalOrDash(p.birthDate)} />
              <Row
                label="Umur"
                value={
                  umur(p.birthDate) === null ? "—" : `${umur(p.birthDate)} tahun`
                }
              />
              <Row label="Jenis kelamin" value={p.gender ?? "—"} />
              <Row label="Agama" value={p.religion ?? "—"} />
            </Group>

            <Group label="Kontak">
              <Row label="Email" value={p.email} />
              <Row label="No. telepon" value={telepon(p.phone)} />
              <Row label="Alamat" value={p.address ?? "—"} />
              <Row label="Kontak darurat" value={p.emergencyName ?? "—"} />
              <Row label="No. darurat" value={telepon(p.emergencyPhone)} />
              <Row
                label="Ubah kontak"
                icon="edit-2"
                chevron
                onPress={() => setEditing(true)}
              />
            </Group>

            <Group label="Kepegawaian">
              <Row label="Divisi" value={p.division} />
              <Row label="Jabatan" value={p.position || "—"} />
              <Row label="Tipe kontrak" value={p.contractType ?? "—"} />
              <Row label="Mulai kerja" value={tanggalOrDash(p.joinedAt)} />
              <Row label="Lokasi kerja" value={p.workLocation} />
            </Group>

            <Text fontSize={11.5} color="$fgSubtle" lineHeight={17}>
              Data identitas dan kepegawaian hanya bisa diubah HR. Hubungi tim HR
              kalau ada yang keliru.
            </Text>

            <KontakSheet
              open={editing}
              onClose={() => setEditing(false)}
              initial={p}
              onSaved={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["me"] });
              }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

type Kontak = {
  phone: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
};

function KontakSheet({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial: Kontak;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [name, setName] = useState(initial.emergencyName ?? "");
  const [emPhone, setEmPhone] = useState(initial.emergencyPhone ?? "");

  const save = useMutation({
    mutationFn: () =>
      postJson<{ ok: true }>(
        "/api/me/profile",
        {
          phone,
          address,
          emergencyName: name,
          emergencyPhone: emPhone,
        },
        "PATCH",
      ),
    onSuccess: () => {
      toast("Kontak diperbarui");
      onSaved();
    },
    // the server owns the format rule, so its message is the one worth showing
    onError: (e: Error) => toast(e.message),
  });

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title="Ubah kontak"
      footer={
        <Btn disabled={save.isPending} onPress={() => save.mutate()}>
          {save.isPending ? "Menyimpan…" : "Simpan"}
        </Btn>
      }
    >
      <YStack gap={13}>
        <Field label="No. telepon">
          <Input
            value={phone}
            onChangeText={setPhone}
            placeholder="08xxxxxxxxxx"
            keyboardType="phone-pad"
          />
        </Field>
        <Field label="Alamat">
          <Input
            value={address}
            onChangeText={setAddress}
            placeholder="Alamat tempat tinggal"
            multiline
            height={72}
            textAlignVertical="top"
          />
        </Field>
        <Field label="Nama kontak darurat">
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Nama keluarga"
          />
        </Field>
        <Field label="No. darurat">
          <Input
            value={emPhone}
            onChangeText={setEmPhone}
            placeholder="08xxxxxxxxxx"
            keyboardType="phone-pad"
          />
        </Field>
        <Text fontSize={11.5} color="$fgSubtle" lineHeight={17}>
          Dipakai HR kalau perlu menghubungi Anda di luar jam kerja.
        </Text>
      </YStack>
    </SheetShell>
  );
}
