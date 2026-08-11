import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Button, Text, XStack, YStack } from "tamagui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/api";
import { usePrefs } from "@/prefs";

const LIGHT_COLORS = {
  background: "#f4f7fb",
  ink: "#14243b",
  muted: "#627086",
  blue: "#2f6fce",
  bluePressed: "#245cad",
  blueSoft: "#dce9fa",
  line: "#d8e1ed",
  paper: "#ffffff",
} as const;

const DARK_COLORS = {
  background: "#101827",
  ink: "#f3f6fb",
  muted: "#9aaac0",
  blue: "#5b9af0",
  bluePressed: "#72aaf5",
  blueSoft: "#1b2d49",
  line: "#2c3a4f",
  paper: "#172235",
} as const;

const SLIDES = [
  {
    image: require("../../assets/onboarding-hero.png"),
    darkImage: require("../../assets/onboarding-hero-dark.png"),
    eyebrow: "KEHADIRAN",
    title: "Absen tanpa ribet.",
    body: "Catat jam masuk dan pulang langsung dari ponsel, lengkap dengan lokasi yang tercatat aman.",
    accessibilityLabel: "Karyawan mencatat kehadiran melalui ponsel",
  },
  {
    image: require("../../assets/onboarding-requests.png"),
    darkImage: require("../../assets/onboarding-requests-dark.png"),
    eyebrow: "PENGAJUAN & BERKAS",
    title: "Administrasi lebih tertata.",
    body: "Ajukan cuti atau lembur, pantau persetujuan, dan temukan dokumen kerja dalam satu tempat.",
    accessibilityLabel: "Karyawan mengelola kalender pengajuan dan dokumen",
  },
  {
    image: require("../../assets/onboarding-team.png"),
    darkImage: require("../../assets/onboarding-team-dark.png"),
    eyebrow: "RUANG BERSAMA",
    title: "Tim selalu terhubung.",
    body: "Ikuti kabar perusahaan, kenali rekan satu tim, dan mulai hari kerja dengan informasi yang tepat.",
    accessibilityLabel: "Tiga rekan kerja berbagi informasi perusahaan",
  },
] as const;

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const systemScheme = useColorScheme();
  const finishOnboarding = useSession((state) => state.finishOnboarding);
  const themePref = usePrefs((state) => state.theme);
  const isDark = themePref === "dark" || (themePref === "system" && systemScheme === "dark");
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const pager = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(0);

  const imageSize = Math.min(width - 38, Math.max(260, height * 0.4), 390);

  useEffect(() => {
    pager.current?.scrollTo({ x: page * width, animated: false });
    // Re-align only when the viewport changes (for example, an accessibility
    // display-size change). Page changes already use the animated `goTo` path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const finish = () => {
    finishOnboarding();
    router.replace("/login");
  };

  const goTo = (nextPage: number) => {
    pager.current?.scrollTo({ x: nextPage * width, animated: true });
    setPage(nextPage);
  };

  const next = () => {
    if (page === SLIDES.length - 1) {
      finish();
      return;
    }
    goTo(page + 1);
  };

  const updatePage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <YStack flex={1} backgroundColor={colors.background} paddingTop={insets.top + 10}>
      <XStack
        height={46}
        paddingHorizontal={20}
        alignItems="center"
        justifyContent="space-between"
      >
        <XStack alignItems="center" gap={9}>
          <XStack
            width={36}
            height={36}
            borderRadius={11}
            alignItems="center"
            justifyContent="center"
            backgroundColor={colors.blueSoft}
          >
            <Image
              source={require("../../assets/logo-mark.png")}
              style={{ width: 27, height: 27 }}
              resizeMode="contain"
              accessibilityLabel="Logo Ruang HR"
            />
          </XStack>
          <YStack gap={1}>
            <Text color={colors.ink} fontSize={14.5} fontWeight="700" letterSpacing={-0.25}>
              Ruang HR
            </Text>
            <Text color={colors.muted} fontSize={9} letterSpacing={0.2}>
              by Nissi Tech Consulting
            </Text>
          </YStack>
        </XStack>

        {page < SLIDES.length - 1 ? (
          <Button
            unstyled
            minWidth={56}
            minHeight={40}
            alignItems="flex-end"
            justifyContent="center"
            color={colors.muted}
            fontSize={12.5}
            fontWeight="600"
            pressStyle={{ opacity: 0.55 }}
            onPress={finish}
            accessibilityHint="Melewati perkenalan dan membuka halaman masuk"
          >
            Lewati
          </Button>
        ) : (
          <YStack width={56} />
        )}
      </XStack>

      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        onMomentumScrollEnd={updatePage}
        accessibilityRole="adjustable"
        accessibilityLabel={`Langkah onboarding ${page + 1} dari ${SLIDES.length}`}
        accessibilityActions={[
          { name: "increment", label: "Langkah berikutnya" },
          { name: "decrement", label: "Langkah sebelumnya" },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment" && page < SLIDES.length - 1) {
            goTo(page + 1);
          }
          if (nativeEvent.actionName === "decrement" && page > 0) {
            goTo(page - 1);
          }
        }}
      >
        {SLIDES.map((slide, index) => {
          const position = index * width;
          const imageOpacity = scrollX.interpolate({
            inputRange: [position - width, position, position + width],
            outputRange: [0.45, 1, 0.45],
            extrapolate: "clamp",
          });
          const imageScale = scrollX.interpolate({
            inputRange: [position - width, position, position + width],
            outputRange: [0.94, 1, 0.94],
            extrapolate: "clamp",
          });

          return (
            <YStack key={slide.title} width={width} flex={1} paddingHorizontal={20}>
              <YStack flex={1} alignItems="center" justifyContent="center">
                <Animated.View
                  style={{
                    width: imageSize,
                    height: imageSize,
                    opacity: imageOpacity,
                    transform: [{ scale: imageScale }],
                  }}
                >
                  <Image
                    source={isDark ? slide.darkImage : slide.image}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="contain"
                    accessibilityLabel={slide.accessibilityLabel}
                  />
                </Animated.View>
              </YStack>

              <YStack paddingBottom={16}>
                <Text
                  color={colors.blue}
                  fontSize={10.5}
                  fontWeight="700"
                  letterSpacing={1.35}
                >
                  {slide.eyebrow}
                </Text>
                <Text
                  color={colors.ink}
                  fontSize={30}
                  lineHeight={35}
                  fontWeight="800"
                  letterSpacing={-1}
                  marginTop={7}
                >
                  {slide.title}
                </Text>
                <Text
                  color={colors.muted}
                  fontSize={14}
                  lineHeight={21}
                  marginTop={9}
                  maxWidth={360}
                >
                  {slide.body}
                </Text>
              </YStack>
            </YStack>
          );
        })}
      </Animated.ScrollView>

      <XStack
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={insets.bottom + 18}
        alignItems="center"
        gap={15}
      >
        {page > 0 ? (
          <Button
            width={52}
            height={52}
            padding={0}
            borderRadius={16}
            borderWidth={1}
            borderColor={colors.line}
            backgroundColor={colors.paper}
            pressStyle={{ backgroundColor: colors.blueSoft, scale: 0.98 }}
            icon={<Feather name="arrow-left" size={18} color={colors.ink} />}
            onPress={() => goTo(page - 1)}
            accessibilityLabel="Kembali ke langkah sebelumnya"
          />
        ) : null}

        <XStack flex={1} alignItems="center" gap={6} accessibilityElementsHidden>
          {SLIDES.map((slide, index) => (
            <YStack
              key={slide.title}
              width={index === page ? 24 : 7}
              height={7}
              borderRadius={4}
              backgroundColor={index === page ? colors.blue : colors.line}
            />
          ))}
        </XStack>

        <Button
          minWidth={page === SLIDES.length - 1 ? 164 : 116}
          height={52}
          paddingHorizontal={18}
          borderRadius={16}
          borderWidth={0}
          backgroundColor={colors.blue}
          color="#ffffff"
          fontSize={14}
          fontWeight="700"
          pressStyle={{ backgroundColor: colors.bluePressed, scale: 0.985 }}
          iconAfter={<Feather name="arrow-right" size={18} color="#ffffff" />}
          onPress={next}
        >
          {page === SLIDES.length - 1 ? "Mulai sekarang" : "Lanjut"}
        </Button>
      </XStack>
    </YStack>
  );
}
