import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Text, XStack, YStack } from "tamagui";
import { API, login } from "@/api";
import { available, loginWithPasskey } from "@/passkey";
import { Btn, Field, Input, Note, Screen } from "@/ui";

/**
 * Email + password, plus passkey when the device and host support it
 * (PRD-Mobile §7). The passkey button is hidden rather than shown-and-failing
 * when it cannot work: a passkey needs an HTTPS host that publishes the
 * association files, so it is absent while pointing at a LAN dev server.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const masuk = useMutation({
    mutationFn: () => login(email.trim().toLowerCase(), password),
  });

  const passkey = useMutation({ mutationFn: loginWithPasskey });
  const bisaPasskey = available();

  const invalid = !email.includes("@") || password.length < 8;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <YStack flex={1} justifyContent="center" paddingHorizontal={26} gap={16}>
          <YStack gap={4} marginBottom={8}>
            <XStack
              width={52}
              height={52}
              borderRadius={16}
              backgroundColor="$accent"
              alignItems="center"
              justifyContent="center"
              marginBottom={12}
            >
              <Text color="$accentFg" fontSize={20} fontWeight="700">
                HR
              </Text>
            </XStack>
            <Text fontSize={24} fontWeight="700" color="$fg">
              Ruang HR
            </Text>
            <Text fontSize={13.5} color="$fgMuted">
              Masuk dengan akun karyawan Anda.
            </Text>
          </YStack>

          <Field label="Email">
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="nama@nusantaradigital.co.id"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
            />
          </Field>

          <Field label="Kata sandi">
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="Minimal 8 karakter"
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry
              onSubmitEditing={() => !invalid && masuk.mutate()}
              returnKeyType="go"
            />
          </Field>

          {masuk.isError || passkey.isError ? (
            <Note
              text={((masuk.error ?? passkey.error) as Error).message}
              fg="$danger"
              bg="$dangerSubtle"
            />
          ) : null}

          <Btn
            disabled={invalid || masuk.isPending}
            onPress={() => masuk.mutate()}
            marginTop={4}
          >
            {masuk.isPending ? "Memeriksa…" : "Masuk"}
          </Btn>

          {bisaPasskey ? (
            <>
              <XStack alignItems="center" gap={10} marginVertical={2}>
                <YStack flex={1} height={1} backgroundColor="$line" />
                <Text fontSize={11} color="$fgSubtle">
                  atau
                </Text>
                <YStack flex={1} height={1} backgroundColor="$line" />
              </XStack>
              <Btn
                tone="ghost"
                disabled={passkey.isPending}
                onPress={() => passkey.mutate()}
              >
                {passkey.isPending ? "Menunggu biometrik…" : "Masuk dengan passkey"}
              </Btn>
            </>
          ) : null}

          <Text fontSize={11.5} color="$fgSubtle" textAlign="center">
            Terhubung ke {API}
          </Text>
        </YStack>
      </KeyboardAvoidingView>
    </Screen>
  );
}
