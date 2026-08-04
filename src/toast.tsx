import { useEffect } from "react";
import { Text, YStack } from "tamagui";
import { create } from "zustand";

/**
 * The mockup's toast: one dark bar above the tab bar, gone after 2.4 s.
 *
 * Skipped @tamagui/toast — it wants a provider, a viewport and (on native) the
 * `burnt` module, to render the same single bar. Add it if we ever need stacked
 * toasts or swipe-to-dismiss.
 */
type ToastState = { message: string; show: (m: string) => void; clear: () => void };

export const useToast = create<ToastState>((set) => ({
  message: "",
  show: (message) => set({ message }),
  clear: () => set({ message: "" }),
}));

export const toast = (message: string) => useToast.getState().show(message);

export function Toast() {
  const { message, clear } = useToast();

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, 2400);
    return () => clearTimeout(t);
  }, [message, clear]);

  if (!message) return null;

  return (
    <YStack
      position="absolute"
      bottom={22}
      left={22}
      right={22}
      backgroundColor="$fg"
      borderRadius={12}
      paddingHorizontal={16}
      paddingVertical={12}
      elevation={8}
      pointerEvents="none"
      transition="quick"
      enterStyle={{ opacity: 0, y: 8 }}
      opacity={1}
      y={0}
    >
      <Text color="$bg" fontSize={13} fontWeight="500" textAlign="center">
        {message}
      </Text>
    </YStack>
  );
}
