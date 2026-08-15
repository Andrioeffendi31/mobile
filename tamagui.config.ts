import { defaultConfig } from "@tamagui/config/v5";
import { animationsReactNative } from "@tamagui/config/v5-rn";
import { createTamagui } from "tamagui";

/**
 * The mockup's CSS custom properties (`NanumHR Lite Mobile.dc.html` :root),
 * mapped into the Tamagui theme as PRD-Mobile §5 asks. tamagui.config.ts feeds
 * these straight in as theme values, so screens name colours (`"$surface"`,
 * `"$fgMuted"`) and this file is the only place a hex code appears.
 */
export const light = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  /**
   * Satu tingkat DI DALAM sebuah kartu — panel di dalam kartu Beranda, blok di
   * dalam sheet Detail Kehadiran. Tidak pernah dipakai langsung di atas $bg.
   *
   * Dulu #fbfcfd: 1% dari putih, yang di layar berarti tidak ada bedanya sama
   * sekali. Tema gelap punya tangga tonal sungguhan (#18191d → #202126 → #27282e)
   * dan tema terang tidak, jadi sheet yang sama terbaca berlapis di gelap dan
   * rata di terang — persis yang terlihat kalau kedua tangkapan layar Detail
   * Kehadiran disandingkan.
   *
   * #f4f6f9 memulihkan tangganya: putih untuk kartu, ini untuk panel di dalamnya,
   * $inset (#eef0f3) untuk chip di dalam panel itu. Nilainya nyaris sama dengan
   * $bg, dan itu tidak apa-apa justru karena ia tidak pernah berdiri di sana.
   */
  surface2: "#f4f6f9",
  inset: "#eef0f3",
  line: "#e6e8ec",
  lineStrong: "#d4d8df",
  fg: "#14161b",
  fgMuted: "#59606d",
  fgSubtle: "#8b93a1",
  /**
   * Inputs get their placeholder hue from this theme key, and leaving it out
   * meant inheriting the v5 preset's — a mid grey picked for the preset's own
   * surfaces, which against ours sat near 2:1 in dark mode and read as an empty
   * field.
   *
   * Not `fgSubtle` (#8b93a1) either: on white that is 3.1:1, which passes for a
   * border but not for the words it actually renders. This is the same hue
   * darkened to 4.9:1 — still visibly quieter than `$fg` typed into the box.
   */
  placeholderColor: "#6b7280",
  accent: "#4f46e5",
  accentHover: "#4338ca",
  accentFill: "#4f46e5",
  accentFillHover: "#4338ca",
  accentFg: "#ffffff",
  accentSubtle: "#eef2ff",
  accentLine: "#c7d2fe",
  success: "#0f7b5a",
  successSubtle: "#e6f5ee",
  warning: "#b4530b",
  warningSubtle: "#fbf0e2",
  danger: "#c0392b",
  dangerSubtle: "#fbeceb",
  /**
   * The *filled* destructive button — "Keluar dari akun", "Coba lagi". The
   * palette's own red, used as a surface rather than as a text hue: it carries a
   * white label at 5.4:1 and stands 5.0:1 clear of the page, where the
   * `dangerSubtle` wash it replaced sat at 1.06:1 and read as a panel that
   * happened to contain red words. A deeper maroon scores higher but stops
   * reading as red.
   */
  dangerFill: "#c0392b",
  dangerFillFg: "#ffffff",
  info: "#1d6fd6",
  infoSubtle: "#e8f1fd",
};

/**
 * Dark mode memakai tangga tonal ala One UI: charcoal netral sebagai kanvas,
 * lalu tiap tingkat surface naik sedikit terang. Pemisahan terutama datang dari
 * tonal elevation, bukan garis biru yang kontras, sehingga kartu terasa menyatu.
 */
export const dark: typeof light = {
  bg: "#0d0e11",
  surface: "#18191d",
  surface2: "#202126",
  inset: "#27282e",
  line: "#2c2d33",
  lineStrong: "#3b3d45",
  fg: "#f5f5f7",
  fgMuted: "#b4b5bd",
  fgSubtle: "#858791",
  placeholderColor: "#92949d",
  accent: "#88a8f2",
  accentHover: "#9ab6f5",
  accentFill: "#5579d7",
  accentFillHover: "#6788df",
  accentFg: "#ffffff",
  accentSubtle: "#20283a",
  accentLine: "#34425f",
  success: "#74c69d",
  successSubtle: "#1c2b24",
  warning: "#e8b86a",
  warningSubtle: "#30281d",
  danger: "#ed858b",
  dangerSubtle: "#301f22",
  /**
   * The same red as the light theme, not this theme's lighter `danger`: #f87171
   * as a surface would take a white label down to 2.8:1. #c0392b is dark enough
   * for white (5.4:1) and still stands 3.5:1 off the page.
   */
  dangerFill: "#c0392b",
  dangerFillFg: "#ffffff",
  info: "#7da6eb",
  infoSubtle: "#202a3a",
};

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  // the react-native driver, not Reanimated: the only motion in the design is
  // sheets sliding and cards fading, which the RN driver does without adding a
  // native animation dependency (PRD-Mobile §8 keeps the bundle small)
  animations: animationsReactNative,
  fonts: {
    ...defaultConfig.fonts,
    /**
     * The mockup's `font-family:'Geist Mono'` — it marks values that must not
     * reflow as they tick (live clock, durations, NIK). The platform monospace
     * face plus tabular figures, not a bundled font file: the requirement is the
     * fixed advance width, and PRD-Mobile §8 keeps the app small.
     *
     * EXPO_OS rather than `Platform.select`: this file is also loaded by the
     * Tamagui compiler in plain Node, where `react-native` cannot be imported.
     */
    mono: {
      ...defaultConfig.fonts.body,
      family: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
    },
  },
  /**
   * The v5 preset ships `onlyAllowShorthands: true` + `styleCompat: "web"`,
   * which accepts only `px`/`bg`/`items` and CSS property names. Both are
   * relaxed here so screens can use the React Native names the mockup's CSS maps
   * onto directly (`paddingHorizontal`, `backgroundColor`, `alignItems`) — one
   * vocabulary across this app and the web one, instead of two.
   */
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
    // the design has literal colours that are not theme values — the avatar
    // palette, and white text on the indigo header — so raw strings stay legal
    allowedStyleValues: false,
  },
  // colours belong to the themes in the v5 config, not to tokens (which are
  // radius/space/size), so the palette is added there and `$accent` resolves
  // through whichever theme is active
  themes: {
    ...defaultConfig.themes,
    light: { ...defaultConfig.themes.light, ...light },
    dark: { ...defaultConfig.themes.dark, ...dark },
  },
});

export default tamaguiConfig;

type Conf = typeof tamaguiConfig;

declare module "tamagui" {
  interface TamaguiCustomConfig extends Conf {}
}
