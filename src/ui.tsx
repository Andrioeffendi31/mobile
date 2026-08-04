import { type ReactNode } from "react";
import {
  Button as TButton,
  Card as TCard,
  Input as TInput,
  Paragraph,
  Spinner,
  Text,
  TextArea as TTextArea,
  XStack,
  YStack,
  styled,
} from "tamagui";
import { att, avatarColor, req } from "@/theme";

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
  fontSize: 13,
  paddingHorizontal: 13,
  paddingVertical: 11,
});

/** Primary action, 46px tall like every submit button in the mockup. */
export const Btn = styled(TButton, {
  height: 46,
  borderRadius: 12,
  borderWidth: 0,
  fontSize: 14,
  fontWeight: "600",
  backgroundColor: "$accent",
  color: "$accentFg",
  pressStyle: { backgroundColor: "$accentHover" },
  // a Button is a stack around a text child, so its pseudo styles carry the
  // surface only — the label colour is handled by the disabled prop itself
  disabledStyle: { backgroundColor: "$inset" },

  variants: {
    tone: {
      danger: {
        backgroundColor: "$dangerSubtle",
        color: "$danger",
        pressStyle: { backgroundColor: "$dangerSubtle", opacity: 0.85 },
      },
      ghost: {
        backgroundColor: "$surface",
        color: "$fgMuted",
        borderWidth: 1,
        borderColor: "$lineStrong",
        pressStyle: { backgroundColor: "$inset" },
      },
    },
    small: {
      true: { height: 32, borderRadius: 9, fontSize: 12, fontWeight: "500" },
    },
  } as const,
});

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
 * Initials on a colour derived from the employee id. Not tamagui's <Avatar>:
 * that one exists to show an image with a fallback, and nobody in this app has
 * a photo until HR uploads one.
 */
export function Avatar({
  seed,
  initials,
  size = 34,
  ...rest
}: {
  /** the employee id — named `seed` because a View already owns `id` and `size`,
   *  and intersecting either with a different type collapses it to never */
  seed: number;
  initials: string;
  size?: number;
} & Omit<React.ComponentProps<typeof XStack>, "size" | "id">) {
  return (
    <XStack
      width={size}
      height={size}
      borderRadius={size / 2}
      backgroundColor={avatarColor(seed)}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      {...rest}
    >
      <Text color="#fff" fontWeight="600" fontSize={size < 30 ? 10 : 11.5}>
        {initials}
      </Text>
    </XStack>
  );
}

/** The Cuti/Lembur and Pengumuman/Berkas switch. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <XStack gap={4} backgroundColor="$inset" borderRadius={12} padding={4} marginBottom={14}>
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
      borderColor={on ? "$accent" : "$lineStrong"}
      color={on ? "$accentFg" : "$fgMuted"}
      aria-selected={on}
      onPress={onPress}
    >
      {label}
    </TButton>
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

export function Loading() {
  return (
    <YStack paddingVertical={48} alignItems="center">
      <Spinner color="$accent" />
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
