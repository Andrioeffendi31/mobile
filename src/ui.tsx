import { Children, type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { Animated, BackHandler } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button as TButton,
  Card as TCard,
  Image,
  Input as TInput,
  Paragraph,
  ScrollView,
  Sheet,
  Spinner,
  Switch,
  Text,
  TextArea as TTextArea,
  XStack,
  YStack,
  styled,
  useTheme,
} from "tamagui";
import { API, useSession } from "@/api";
import { att, avatarColor, req, tint } from "@/theme";

/**
 * The shapes the mockup repeats, as styled() components so Tamagui's compiler
 * can flatten them. Anything used once stays inline in its screen — a wrapper
 * with a single caller is harder to read than the markup it hides.
 */

/** The mockup's default panel: white, 1px border, 13px radius. */
export const Card = styled(TCard, {
  backgroundColor: "$surface",
  borderWidth: 1,
  borderColor: "$line",
  borderRadius: 13,
  padding: 13,
});

export const Screen = styled(YStack, {
  flex: 1,
  backgroundColor: "$bg",
});

export const Title = styled(Text, {
  fontSize: 21,
  fontWeight: "700",
  color: "$fg",
  marginTop: 12,
  marginBottom: 14,
});

export const SectionLabel = styled(Text, {
  fontSize: 13.5,
  fontWeight: "600",
  color: "$fg",
});

/** Numbers that must not jitter as they tick — see the `mono` font in the config. */
export const Mono = styled(Text, {
  fontFamily: "$mono",
  fontVariant: ["tabular-nums"],
  color: "$fg",
});

export const Input = styled(TInput, {
  height: 42,
  borderWidth: 1,
  borderColor: "$lineStrong",
  borderRadius: 11,
  backgroundColor: "$surface",
  color: "$fg",
  /**
   * Tamagui leaves this prop unset, so an input falls back to the platform's own
   * placeholder grey — ~#c7c7cd, which is 1.6:1 on white and invisible over the
   * dark surface. `$placeholderColor` is the palette's own, 4.9:1 / 4.7:1.
   */
  placeholderTextColor: "$placeholderColor",
  fontSize: 13.5,
  paddingHorizontal: 13,
});

export const TextArea = styled(TTextArea, {
  minHeight: 74,
  borderWidth: 1,
  borderColor: "$lineStrong",
  borderRadius: 11,
  backgroundColor: "$surface",
  color: "$fg",
  placeholderTextColor: "$placeholderColor",
  fontSize: 13,
  paddingHorizontal: 13,
  paddingVertical: 10,
  /**
   * Android centres the text inside a multiline input, so a 74px box put the
   * placeholder in the middle with a band of nothing above and below it — which
   * reads as absurd padding rather than as an empty three-line field. Top-aligned,
   * the same box looks like somewhere to write.
   */
  textAlignVertical: "top",
});

/** Primary action, 46px tall like every submit button in the mockup. */
const BtnFrame = styled(TButton, {
  height: 46,
  borderRadius: 12,
  borderWidth: 0,
  fontSize: 14,
  fontWeight: "600",
  backgroundColor: "$accent",
  color: "$accentFg",
  pressStyle: { backgroundColor: "$accentHover" },
  disabledStyle: { backgroundColor: "$inset" },

  variants: {
    tone: {
      /**
       * Destructive, and it has to look it: filled, not a pale wash. The old
       * $dangerSubtle surface sat 1.06:1 off the page and read as a panel that
       * happened to contain red words. Deviates from the design system's
       * outlined "Hapus" button on purpose — a solid dark red is what a logout
       * this final should look like.
       */
      danger: {
        backgroundColor: "$dangerFill",
        color: "$dangerFillFg",
        pressStyle: { backgroundColor: "$dangerFill", opacity: 0.85 },
      },
      /**
       * $lineStrong here was 1.43:1 against the surface and 1.32:1 against the
       * page — under the 3:1 WCAG 1.4.11 asks of a control's boundary, and in
       * practice a button you had to hunt for. $fgMuted matches the label and
       * clears 3:1 in both themes.
       */
      ghost: {
        backgroundColor: "$surface",
        color: "$fgMuted",
        borderWidth: 1,
        borderColor: "$fgMuted",
        pressStyle: { backgroundColor: "$inset" },
      },
    },
    small: {
      true: { height: 32, borderRadius: 9, fontSize: 12, fontWeight: "500" },
    },
  } as const,
});

/**
 * The button, plus the one thing `disabledStyle` cannot express: a Button is a
 * stack around a Text child, so a pseudo style reaches the frame and never the
 * label. That left the disabled primary as white-on-$inset — 1.14:1, an
 * invisible label — so the mockup's own disabled pair (`background: inset`,
 * `color: fg-subtle`) is applied here instead. Last in prop order on purpose:
 * it has to win over whatever colour the `tone` variant set.
 */
export function Btn({ disabled, ...rest }: ComponentProps<typeof BtnFrame>) {
  return <BtnFrame {...rest} disabled={disabled} {...(disabled ? { color: "$fgSubtle" } : null)} />;
}

export function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <XStack backgroundColor={bg} borderRadius={20} paddingHorizontal={9} paddingVertical={3}>
      <Text fontSize={10.5} fontWeight="600" color={fg}>
        {label}
      </Text>
    </XStack>
  );
}

export const AttBadge = ({ status }: { status: string }) => <Badge {...att(status)} />;
export const ReqBadge = ({ status }: { status: string }) => <Badge {...req(status)} />;

/**
 * The employee's photo, or their initials on a colour derived from their id.
 *
 * Not tamagui's <Avatar>: that one is an image with a fallback, and the fallback
 * here is the more interesting half — most people have no photo, and the coloured
 * initials have to match the web console's, which derives the same colour from the
 * same id.
 *
 * The photo is cropped to fill the circle (`cover`), never letterboxed: a face
 * squeezed to fit a square is worse than a face with its edges outside it.
 */
export function Avatar({
  seed,
  initials,
  photoKey,
  size = 34,
  ...rest
}: {
  /** the employee id — named `seed` because a View already owns `id` and `size`,
   *  and intersecting either with a different type collapses it to never */
  seed: number;
  initials: string;
  /** R2 object key from the API; absent for everybody who has not set one */
  photoKey?: string | null;
  size?: number;
} & Omit<React.ComponentProps<typeof XStack>, "size" | "id">) {
  /**
   * /api/files streams a `photo/…` key rather than presigning it, so the session
   * travels as a header on the image request — the same reason the attendance
   * selfies do. The key itself changes on every upload, so nothing has to be
   * cache-busted here.
   */
  const cookie = useSession((st) => st.cookie);

  return (
    <XStack
      width={size}
      height={size}
      borderRadius={size / 2}
      backgroundColor={avatarColor(seed)}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      overflow="hidden"
      {...rest}
    >
      {photoKey ? (
        <Image
          source={{
            uri: `${API}/api/files/${photoKey}`,
            ...(cookie ? { headers: { cookie } } : {}),
          }}
          width={size}
          height={size}
          resizeMode="cover"
          accessibilityLabel={`Foto ${initials}`}
        />
      ) : (
        <Text color="#fff" fontWeight="600" fontSize={size < 30 ? 10 : 11.5}>
          {initials}
        </Text>
      )}
    </XStack>
  );
}

/** The Cuti/Lembur and Pengumuman/Berkas switch. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  ...rest
}: {
  value: V;
  /** `icon` is optional — the content switchers use labels alone, the settings
   *  ones pair each label with a glyph so the row scans without being read */
  options: { value: V; label: string; icon?: ComponentProps<typeof Feather>["name"] }[];
  onChange: (v: V) => void;
} & Omit<ComponentProps<typeof XStack>, "onChange">) {
  return (
    <XStack
      gap={4}
      backgroundColor="$inset"
      borderRadius={12}
      padding={4}
      marginBottom={14}
      {...rest}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TButton
            key={o.value}
            flex={1}
            height={36}
            borderRadius={9}
            borderWidth={0}
            fontSize={13}
            fontWeight="600"
            backgroundColor={on ? "$surface" : "transparent"}
            color={on ? "$fg" : "$fgMuted"}
            elevation={on ? 1 : 0}
            aria-selected={on}
            onPress={() => onChange(o.value)}
            icon={
              o.icon ? (
                <Feather name={o.icon} size={13} color={tint(on ? "$fg" : "$fgSubtle")} />
              ) : undefined
            }
          >
            {o.label}
          </TButton>
        );
      })}
    </XStack>
  );
}

/** The team filter pills. */
export function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <TButton
      height={32}
      paddingHorizontal={13}
      borderRadius={20}
      borderWidth={1}
      fontSize={12.5}
      fontWeight="400"
      backgroundColor={on ? "$accent" : "$surface"}
      // $lineStrong left an unselected pill at 1.43:1 against its surface; the
      // label carries the on/off state, but the pill still has to have an edge
      borderColor={on ? "$accent" : "$fgSubtle"}
      color={on ? "$accentFg" : "$fgMuted"}
      aria-selected={on}
      onPress={onPress}
    >
      {label}
    </TButton>
  );
}

/**
 * The screen header: title, optional subtitle, optional back button. Every
 * screen that is not a tab root needs the same 36px chevron in the same place,
 * and the safe-area top belongs with it rather than in each screen.
 */
export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // the live theme value, not tint(): tint() resolves against the light palette on
  // purpose (icons inside coloured chips keep their hue), which for a bare chevron
  // would mean near-black on a dark background
  const theme = useTheme();

  return (
    <XStack
      paddingTop={insets.top + 9}
      paddingHorizontal={18}
      paddingBottom={15}
      alignItems="center"
      gap={10}
    >
      {onBack ? (
        /**
         * A bare chevron, not a bordered tile. Going back is the most predictable
         * control on any screen and does not need a box to announce itself — the
         * box only competed with the title beside it.
         *
         * The 40px target stays (the glyph is 24px), and the negative margin pulls
         * the *glyph* out to the 18px gutter so it lines up with the title rather
         * than sitting visually indented by its own padding.
         */
        <XStack
          width={40}
          height={40}
          marginLeft={-9}
          marginRight={-4}
          alignItems="center"
          justifyContent="center"
          pressStyle={{ opacity: 0.45 }}
          onPress={onBack}
          accessibilityRole="button"
          aria-label="Kembali"
        >
          <Feather name="chevron-left" size={24} color={theme.fg?.val} />
        </XStack>
      ) : null}
      <YStack flex={1}>
        <Text fontSize={21} fontWeight="700" color="$fg" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text fontSize={11.5} color="$fgSubtle" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </YStack>
      {right}
    </XStack>
  );
}

/**
 * The switch, with its two track colours in one place. $lineStrong for "off" was
 * 1.43:1 against a card — a switch you could not see was off — so the off track
 * is $fgSubtle, and the on track is the accent.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Switch
      size="$3"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      backgroundColor={checked ? "$accent" : "$fgSubtle"}
      aria-label={label}
    >
      {/* transition, not `animation`: v5's config drives the thumb the same way
          the toast slides in */}
      <Switch.Thumb transition="quick" backgroundColor="#fff" />
    </Switch>
  );
}

/** The small caps-ish label above a settings group ("Keamanan", "Notifikasi"). */
export const GroupLabel = styled(Text, {
  fontSize: 11.5,
  fontWeight: "600",
  color: "$fgMuted",
  marginHorizontal: 2,
});

/**
 * A labelled block of <Row>s in one clipped card — the shape the Pengaturan
 * mockup repeats for every section. The 1px rule between rows is drawn here
 * rather than by each row, so a conditionally rendered row cannot leave a
 * dangling divider behind (Children.toArray drops the nulls first).
 */
export function Group({
  label,
  children,
  ...rest
}: { label?: string; children: ReactNode } & ComponentProps<typeof YStack>) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  return (
    <YStack gap={8} {...rest}>
      {label ? <GroupLabel>{label}</GroupLabel> : null}
      <Card padding={0} overflow="hidden">
        {rows.map((row, i) =>
          i === 0 ? (
            row
          ) : (
            <YStack key={i} borderTopWidth={1} borderTopColor="$line">
              {row}
            </YStack>
          ),
        )}
      </Card>
    </YStack>
  );
}

/**
 * One line inside a <Group>: tinted icon, label, note, and whatever belongs on
 * the right — a value, a <Switch>, a <Btn>, or a chevron when the row navigates.
 *
 * 54px minimum so every row clears the 48dp touch target, and the whole row is
 * the target rather than the control at its end.
 */
export function Row({
  label,
  note,
  noteTone = "$fgSubtle",
  icon,
  iconFg = "$fgMuted",
  iconBg = "$inset",
  value,
  right,
  chevron,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  note?: string;
  /** token — a note that reports a problem is worth $warning or $danger */
  noteTone?: string;
  icon?: ComponentProps<typeof Feather>["name"];
  iconFg?: string;
  iconBg?: string;
  /** the current setting, shown at the end of the row ("Bahasa Indonesia") */
  value?: string;
  right?: ReactNode;
  chevron?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const live = Boolean(onPress) && !disabled && !loading;

  return (
    <XStack
      minHeight={54}
      paddingHorizontal={14}
      paddingVertical={11}
      alignItems="center"
      gap={12}
      backgroundColor="$surface"
      opacity={disabled ? 0.45 : 1}
      onPress={live ? onPress : undefined}
      pressStyle={live ? { backgroundColor: "$surface2" } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      aria-label={note ? `${label}. ${note}` : label}
    >
      {icon ? (
        <YStack
          width={34}
          height={34}
          borderRadius={10}
          backgroundColor={iconBg}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Feather name={icon} size={17} color={tint(iconFg)} />
        </YStack>
      ) : null}

      <YStack flex={1} gap={2}>
        <Text fontSize={13.5} fontWeight="500" color="$fg">
          {label}
        </Text>
        {note ? (
          <Text fontSize={11.5} color={noteTone} lineHeight={16}>
            {note}
          </Text>
        ) : null}
      </YStack>

      {loading ? <Spinner size="small" color="$fgSubtle" /> : right}
      {value && !loading ? (
        <Text fontSize={12} color="$fgSubtle" maxWidth={120} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron ? (
        <Feather name="chevron-right" size={15} color={tint("$fgSubtle")} />
      ) : null}
    </XStack>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <YStack>
      <Text fontSize={11.5} fontWeight="500" color="$fgMuted" marginBottom={6}>
        {label}
      </Text>
      {children}
    </YStack>
  );
}

/** "Durasi terhitung · 3 hari kerja" — the strip both request forms share. */
export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <XStack
      backgroundColor="$surface2"
      borderWidth={1}
      borderColor="$line"
      borderRadius={11}
      paddingHorizontal={13}
      paddingVertical={11}
      alignItems="center"
      justifyContent="space-between"
      gap={10}
    >
      <Text fontSize={12.5} color="$fgMuted" flexShrink={1}>
        {label}
      </Text>
      <Mono fontSize={13} fontWeight="600">
        {value}
      </Mono>
    </XStack>
  );
}

/** Coloured note block — the info/warning callouts in the mockup's sheets. */
export function Note({
  text,
  fg = "$info",
  bg = "$infoSubtle",
}: {
  text: string;
  fg?: string;
  bg?: string;
}) {
  return (
    <YStack backgroundColor={bg} borderRadius={12} paddingHorizontal={13} paddingVertical={11}>
      <Paragraph fontSize={12} color={fg} lineHeight={18}>
        {text}
      </Paragraph>
    </YStack>
  );
}

/**
 * Android back — the button and the edge-swipe gesture, which dispatch the same
 * event — runs `onBack` instead of navigating, while `active`.
 *
 * Without it, backing out of an open sheet pops the *screen* underneath: the
 * employee lands on the previous tab having lost a half-filled form, and the only
 * clue anything was dismissed is that it is gone. Returning true consumes the press
 * so navigation never also acts on it.
 *
 * Bound only while active, so the four sheets mounted at any moment cannot swallow
 * a back press between them. RN calls handlers in reverse registration order, so
 * the thing opened last — a photo preview over a sheet — answers first.
 */
export function useAndroidBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [active, onBack]);
}

/**
 * The mockup's bottom sheet: 22px top corners, a drag handle, a fixed title, and
 * a scrolling middle so a long body cannot push the footer off screen.
 *
 * Shared by the request forms and the announcement detail. `footer` is optional —
 * a form needs its submit row pinned, a read-only sheet only needs the handle and
 * the overlay to get out of.
 */
export function SheetShell({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useAndroidBack(open, onClose);

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
        {footer ? (
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
        ) : null}
      </Sheet.Frame>
    </Sheet>
  );
}

/**
 * The confirmation sheet, in place of Alert.alert.
 *
 * A system alert is the one surface in the app that is not the app: it arrives in
 * the OS's own typography, ignores the theme (a light box over a dark screen on
 * Android), and orders its buttons differently per platform. Same question, same
 * bottom sheet as everything else instead.
 *
 * `snapPointsMode="fit"` — a confirmation is as tall as its buttons; the 88%
 * <SheetShell> is for forms. "Batal" is always last and always just closes, so the
 * dismissing action sits nearest the thumb and never has to be passed in.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  actions: { label: string; tone?: ComponentProps<typeof Btn>["tone"]; onPress: () => void }[];
}) {
  const insets = useSafeAreaInsets();
  useAndroidBack(open, onClose);

  return (
    <Sheet
      modal
      open={open}
      onOpenChange={(next: boolean) => !next && onClose()}
      snapPointsMode="fit"
      dismissOnSnapToBottom
      transition="medium"
    >
      <Sheet.Overlay backgroundColor="rgba(20,22,27,.42)" />
      <Sheet.Handle />
      <Sheet.Frame
        backgroundColor="$surface"
        borderTopLeftRadius={22}
        borderTopRightRadius={22}
        paddingTop={14}
        paddingHorizontal={22}
        paddingBottom={insets.bottom + 18}
        gap={9}
      >
        <Text fontSize={17} fontWeight="700" color="$fg">
          {title}
        </Text>
        {message ? (
          <Text fontSize={13.5} lineHeight={19} color="$fgMuted" marginBottom={4}>
            {message}
          </Text>
        ) : null}
        {actions.map((action) => (
          <Btn
            key={action.label}
            tone={action.tone}
            onPress={() => {
              // close first: the sheet's exit animation should not wait on whatever
              // the action does, and every action here dismisses the question
              onClose();
              action.onPress();
            }}
          >
            {action.label}
          </Btn>
        ))}
        <Btn tone="ghost" onPress={onClose}>
          Batal
        </Btn>
      </Sheet.Frame>
    </Sheet>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <YStack
      borderWidth={1}
      borderColor="$lineStrong"
      borderStyle="dashed"
      borderRadius={13}
      padding={28}
      alignItems="center"
    >
      <Text fontSize={13} color="$fgSubtle" textAlign="center">
        {text}
      </Text>
    </YStack>
  );
}

/**
 * The pulse every skeleton block shares. One loop per block rather than a
 * module-level Animated.Value: blocks mount in the same frame so they are in
 * phase anyway, and this way nothing is animating while nothing is loading.
 *
 * RN's Animated rather than Tamagui's driver — a repeating animation is the one
 * thing `transition` cannot express, and opacity on the native driver costs no
 * JS per frame.
 */
function usePulse() {
  const value = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.45, duration: 620, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);

  return value;
}

/**
 * One block of not-yet-arrived content. Deliberately a narrow API — width,
 * height, radius, colour — because a skeleton only ever needs to stand in for a
 * line of text, a tile, or a chip.
 */
export function Skeleton({
  width = "100%",
  height = 10,
  radius = 6,
  color = "$inset",
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  /** theme token, or a literal for the ones that sit on the indigo header */
  color?: string;
}) {
  const theme = useTheme();
  const pulse = usePulse();
  const resolved = color.startsWith("$")
    ? ((theme as unknown as Record<string, { val?: string }>)[color.slice(1)]?.val ?? color)
    : color;

  return (
    <Animated.View
      style={{
        width: width as number,
        height,
        borderRadius: radius,
        backgroundColor: resolved,
        opacity: pulse,
      }}
    />
  );
}

/**
 * The list placeholder: leading tile, two lines, trailing chip — the card every
 * list in this app repeats (kehadiran, tim, berkas, pengumuman). Line widths
 * vary per row so the placeholder reads as text that has not loaded rather than
 * as a table.
 *
 * Skeletons over a spinner because every one of those screens knows the shape of
 * what it is fetching: the layout stops jumping when the data lands, and the
 * wait is spent looking at where the content will be.
 */
export function SkeletonRows({
  count = 4,
  lead = 34,
  trail = true,
}: {
  count?: number;
  /** size of the leading tile, or 0 for the cards that have none */
  lead?: number;
  trail?: boolean;
}) {
  const widths = ["68%", "52%", "60%", "45%"];

  return (
    <YStack gap={8} aria-label="Memuat" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <Card
          key={i}
          flexDirection="row"
          alignItems="center"
          gap={11}
          paddingHorizontal={13}
          paddingVertical={13}
        >
          {lead ? <Skeleton width={lead} height={lead} radius={10} /> : null}
          <YStack flex={1} gap={7}>
            <Skeleton height={11} width={widths[i % widths.length]} />
            <Skeleton height={9} width="40%" />
          </YStack>
          {trail ? <Skeleton width={54} height={20} radius={20} /> : null}
        </Card>
      ))}
    </YStack>
  );
}

export function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <YStack
      backgroundColor="$dangerSubtle"
      borderRadius={13}
      padding={20}
      alignItems="center"
      gap={10}
    >
      <Text fontSize={13} color="$danger" textAlign="center">
        {message}
      </Text>
      {onRetry ? (
        <Btn tone="danger" small onPress={onRetry}>
          Coba lagi
        </Btn>
      ) : null}
    </YStack>
  );
}
