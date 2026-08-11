import { defaultConfig } from "@tamagui/config/v5";
import { animationsReactNative } from "@tamagui/config/v5-rn";
import { createTamagui } from "tamagui";

/**
 * The mockup's CSS custom properties (`Ruang HR Lite Mobile.dc.html` :root),
 * mapped into the Tamagui theme as PRD-Mobile §5 asks. tamagui.config.ts feeds
 * these straight in as theme values, so screens name colours (`"$surface"`,
 * `"$fgMuted"`) and this file is the only place a hex code appears.
 */
export const light = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  surface2: "#fbfcfd",
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
 * The mockup only ships a light palette. This is the same set with surfaces
 * inverted and status hues lifted for contrast, so `userInterfaceStyle` has
 * something to switch to (PRD-Mobile §6.7). Same keys on purpose: no screen
 * ever branches on the colour scheme.
 */
export const dark: typeof light = {
  bg: "#0f1115",
  surface: "#171a21",
  surface2: "#1c2029",
  inset: "#22262f",
  line: "#272c36",
  lineStrong: "#343a46",
  fg: "#f2f4f7",
  fgMuted: "#a2abba",
  fgSubtle: "#79828f",
  // 4.7:1 on $surface, where the inherited default sat near 2:1
  placeholderColor: "#7e8794",
  accent: "#6366f1",
  accentHover: "#818cf8",
  accentFg: "#ffffff",
  accentSubtle: "#1e2140",
  accentLine: "#3a3f7a",
  success: "#34d399",
  successSubtle: "#10281f",
  warning: "#fbbf24",
  warningSubtle: "#2a1f0d",
  danger: "#f87171",
  dangerSubtle: "#2b1414",
  /**
   * The same red as the light theme, not this theme's lighter `danger`: #f87171
   * as a surface would take a white label down to 2.8:1. #c0392b is dark enough
   * for white (5.4:1) and still stands 3.5:1 off the page.
   */
  dangerFill: "#c0392b",
  dangerFillFg: "#ffffff",
  info: "#60a5fa",
  infoSubtle: "#12213a",
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
