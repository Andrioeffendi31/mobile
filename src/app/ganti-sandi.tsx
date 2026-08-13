import { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, Text, YStack } from "tamagui";
import { type Bootstrap, get, login, postJson } from "@/api";
import { toast } from "@/toast";
import { Btn, Card, Field, Input, PageHeader, Screen } from "@/ui";

/**
 * Buat kata sandi baru.
 *
 * Reached in two ways: forced, when the account still carries the shared password
 * HR handed out at the import (the root Gate redirects here and nowhere else), or
 * voluntarily from Pengaturan. The difference is only whether the current password
 * is asked for — the server decides that from the same flag, so the screen cannot
 * grant itself the easier path by lying about which mode it is in.
 */
export default function GantiSandi() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => get<Bootstrap>("/api/me"),
  });
  const wajib = me.data?.profile.mustChangePassword ?? false;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const save = useMutation({
    mutationFn: () =>
      postJson<{ ok: true }>("/api/me/password", {
        next,
        ...(wajib ? {} : { current }),
      }),
    onSuccess: async () => {
      toast("Kata sandi diperbarui");
      /**
       * Swap the stored cookie for a fresh one before anything else.
       *
       * The change stamps `passwordChangedAt` server-side, which invalidates every
       * token minted earlier — this phone's included. Without signing in again the
       * very next request would 401 and dump the user back at the login screen
       * seconds after they successfully set a password. `login()` stores the new
       * cookie in SecureStore, so the eviction lands on the other devices only.
       */
      if (me.data) await login(me.data.profile.email, next);
      // the flag lives in this payload, so the Gate only lets go once it refetches
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/");
    },
    onError: (e: Error) => toast(e.message),
  });

  const submit = () => {
    // The strength rule itself is the server's (web/src/lib/hr.ts cekSandi) and its
    // message lands in the catch below — this app does not keep a second copy of a
    // rule that decides an outcome (PRD-Mobile §10). Only the two things the server
    // cannot see are checked here: the confirmation field, and an empty submit.
    if (!next) return toast("Kata sandi baru belum diisi");
    if (next !== confirm) return toast("Konfirmasi kata sandi tidak sama");
    save.mutate();
  };

  return (
    <Screen>
      <PageHeader
        title={wajib ? "Buat kata sandi baru" : "Ganti kata sandi"}
        subtitle={me.data?.profile.email}
        // no back button while it is mandatory: there is nowhere to go back to
        onBack={wajib ? undefined : () => router.back()}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: 28,
          gap: 16,
        }}
      >
        {wajib ? (
          <Text fontSize={12.5} color="$fgMuted" lineHeight={19}>
            Akun Anda masih memakai kata sandi sementara yang dibagikan HR. Buat
            kata sandi sendiri untuk melanjutkan.
          </Text>
        ) : null}

        <Card padding={16} gap={13}>
          {!wajib ? (
            <Field label="Kata sandi saat ini">
              <Input
                value={current}
                onChangeText={setCurrent}
                secureTextEntry
                autoComplete="current-password"
              />
            </Field>
          ) : null}
          <Field label="Kata sandi baru">
            <Input
              value={next}
              onChangeText={setNext}
              secureTextEntry
              autoComplete="new-password"
            />
            <Text fontSize={11.5} color="$fgSubtle" lineHeight={17} marginTop={5}>
              Minimal 8 karakter, memuat huruf kapital, angka, dan simbol.
            </Text>
          </Field>
          <Field label="Ulangi kata sandi baru">
            <Input
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
            />
          </Field>
          <YStack marginTop={3}>
            <Btn disabled={save.isPending} onPress={submit}>
              {save.isPending ? "Menyimpan…" : "Simpan kata sandi"}
            </Btn>
          </YStack>
        </Card>
      </ScrollView>
    </Screen>
  );
}
