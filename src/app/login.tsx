import { useEffect, useState } from "react";
import { Image, Keyboard, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
/**
 * The keyboard's height while it is up, 0 otherwise.
 *
 * <KeyboardAvoidingView> used to do this job and no longer can: Android is
 * edge-to-edge since SDK 54, so the window keeps its full height when the
 * keyboard appears (`adjustResize` in the manifest is inert under it) and the
 * keyboard simply covers the bottom of the screen — the "Masuk" button. The
 * measurement the events carry is the one thing that still describes it, and
 * turning it into padding is less code than a keyboard library.
 */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it slides in, which keeps the padding in
    // step with the animation; Android only has the "did" pair.
    const ios = Platform.OS === "ios";
    const shown = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hidden = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setHeight(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}

export default function Login() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const keyboard = useKeyboardHeight();

  const masuk = useMutation({
    mutationFn: () => login(email.trim().toLowerCase(), password),
  });

  const passkey = useMutation({ mutationFn: loginWithPasskey });
  const bisaPasskey = available();

  const invalid = !email.includes("@") || password.length < 8;

  return (
    <Screen>
      {/*
       * The form used to be a centred flex child. Once the keyboard is up — or on
       * a short screen — its content is taller than the box, and a centred
       * overflow spills past the parent's bounds: Android delivers no touch
       * outside a parent, so the lower half of "Masuk" simply stopped responding.
       * A scroll view with `flexGrow` keeps the centring while it fits and scrolls
       * instead of overflowing when it does not.
       */}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 26,
          paddingTop: insets.top + 24,
          // the keyboard eats the home indicator / navigation bar it would
          // otherwise clear, so it replaces that inset rather than stacking on it
          paddingBottom: Math.max(insets.bottom, keyboard) + 24,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <YStack gap={16}>
          <YStack gap={4} marginBottom={8}>
            <XStack
              width={52}
              height={52}
              borderRadius={16}
              backgroundColor="$accentSubtle"
              alignItems="center"
              justifyContent="center"
              marginBottom={12}
            >
              <Image
                source={require("../../assets/logo-mark.png")}
                style={{ width: 38, height: 38 }}
                resizeMode="contain"
                accessibilityLabel="Logo Ruang HR"
              />
            </XStack>
            <Text fontSize={24} fontWeight="700" color="$fg">
              Ruang HR
            </Text>
            <Text fontSize={13.5} color="$fgMuted">
              Masuk dengan akun Ruang HR Anda.
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
      </ScrollView>
    </Screen>
  );
}
