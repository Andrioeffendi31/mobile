import {
  Children,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  BackHandler,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "@tamagui/linear-gradient";
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
import { type Href, useIsFocused, useRouter } from "expo-router";
import { API, useSession } from "@/api";
import { jamWib } from "@/format";
import { att, avatarColor, req, tint } from "@/theme";

/**
 * The shapes the mockup repeats, as styled() components so Tamagui's compiler
 * can flatten them. Anything used once stays inline in its screen — a wrapper
 * with a single caller is harder to read than the markup it hides.
 */

/**
 * The mockup's default panel: white, 1px border, rounded.
 *
 * Radius 16 dan bayangan lembut mengikuti rancangan baru. Garis 1px tetap ada
 * karena di tema gelap bayangan tidak terlihat sama sekali — di sana garis itulah
 * yang memisahkan kartu dari latarnya.
 */
export const Card = styled(TCard, {
  backgroundColor: "$surface",
  borderWidth: 1,
  borderColor: "$line",
  borderRadius: 16,
  padding: 13,
  shadowColor: "#14161b",
  shadowOpacity: 0.05,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 2 },
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

/**
 * Large intro used by the three data-heavy tab roots. Kept separate from
 * PageHeader: these titles scroll with a FlatList, while PageHeader is a fixed
 * safe-area header for settings/detail screens.
 */
export function PageIntro({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <YStack gap={3}>
      <Text
        fontSize={28}
        lineHeight={33}
        fontWeight="700"
        letterSpacing={-0.8}
        color="$fg"
      >
        {title}
      </Text>
      <Text fontSize={12.5} lineHeight={18} color="$fgMuted">
        {subtitle}
      </Text>
    </YStack>
  );
}

/**
 * Bar ringkas One UI: strip buram setinggi safe-area yang muncul begitu judul
 * besar tergulir lewat, dengan judul yang sama dalam ukuran kecil.
 *
 * Dua tugas sekaligus, dan yang kedua yang membuatnya wajib di setiap tab root:
 * isi layar menggulir SAMPAI ke bawah jam dan ikon baterai, jadi tanpa strip ini
 * kartu-kartu lewat di belakang status bar dan angka jamnya berdiri di atas teks.
 * Karena itu Beranda pun memakainya, hanya tanpa judul — di sana yang dibutuhkan
 * memang cuma stripnya.
 *
 * Selalu `pointerEvents="none"`: tidak ada apa pun di dalamnya yang bisa ditekan,
 * dan bar tak terlihat yang memakan sentuhan di puncak layar adalah bug yang
 * mahal ditemukan.
 */
export function StickyHeader({ shown, title }: { shown: boolean; title?: string }) {
  const insets = useSafeAreaInsets();

  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      pointerEvents="none"
      backgroundColor="$bg"
      paddingTop={insets.top}
      opacity={shown ? 1 : 0}
      transition="quick"
    >
      {title ? (
        <YStack height={52} justifyContent="center" paddingHorizontal={20}>
          <Text fontSize={17} fontWeight="600" color="$fg" numberOfLines={1}>
            {title}
          </Text>
        </YStack>
      ) : null}
      <YStack height={1} backgroundColor="$line" />
    </YStack>
  );
}

/**
 * Pasangan <StickyHeader>: sebuah boolean dan handler onScroll untuk dipasang ke
 * FlatList / ScrollView layarnya.
 *
 * Sengaja BUKAN Animated.Value yang diinterpolasi. Yang perlu diketahui bar itu
 * satu bit — sudah lewat atau belum — dan React membatalkan render ketika
 * setState menerima nilai yang sama, jadi handler ini berjalan tiap 32 ms tapi
 * hanya menghasilkan dua render sepanjang satu gulir penuh. Interpolasi terikat
 * gulir menuntut Animated.FlatList, yang menghapus tipe generik itemnya, demi
 * pudar yang bagaimanapun berlangsung di bawah 100 ms.
 *
 * `ambang - 12` saat sedang tampil adalah histeresis: tanpa jeda itu, gulir yang
 * berhenti tepat di ambangnya membuat barnya berkedip-kedip.
 *
 * Bawaan 56 kira-kira tinggi judul besar: barnya menyusul persis ketika judul itu
 * habis. Layar tanpa judul (Beranda) melewatkan angka jauh lebih kecil — di sana
 * yang harus tertutup adalah kartu pertama, dan itu sudah bergerak pada piksel
 * pertama gulir.
 */
export function useStickyHeader(ambang = 56) {
  const [shown, setShown] = useState(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      setShown((on) => y > (on ? ambang - 12 : ambang));
    },
    [ambang],
  );

  return { shown, onScroll, scrollEventThrottle: 32 };
}

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

/** Live clock shared by screens that only need to repaint this one text node. */
export function Jam({ active = true, ...props }: ComponentProps<typeof Mono> & { active?: boolean }) {
  const [value, setValue] = useState(() => jamWib(true));

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setValue(jamWib(true)), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  return <Mono {...props}>{value}</Mono>;
}

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
  backgroundColor: "$accentFill",
  color: "$accentFg",
  pressStyle: { backgroundColor: "$accentFillHover" },
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
export function Btn({
  disabled,
  grad,
  children,
  ...rest
}: ComponentProps<typeof BtnFrame> & {
  /** pasangan gradien dari theme.GRAD; menang atas `backgroundColor` */
  grad?: readonly [string, string];
}) {
  return (
    <BtnFrame
      {...rest}
      disabled={disabled}
      {...(grad ? { backgroundColor: "transparent", overflow: "hidden" as const } : null)}
      {...(disabled && !grad ? { color: "$fgSubtle" } : null)}
    >
      {/* lapisan pertama, di belakang label: latar tombol tidak bisa bergradien
          sendiri, jadi gradiennya sebuah anak yang memenuhi bingkainya */}
      {grad ? (
        <LinearGradient
          position="absolute"
          width="100%"
          height="100%"
          colors={[...grad]}
          start={[0, 0]}
          end={[1, 1]}
        />
      ) : null}
      {children}
    </BtnFrame>
  );
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
      backgroundColor={on ? "$accentFill" : "$surface"}
      // $lineStrong left an unselected pill at 1.43:1 against its surface; the
      // label carries the on/off state, but the pill still has to have an edge
      borderColor={on ? "$accentFill" : "$fgSubtle"}
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
      backgroundColor={checked ? "$accentFill" : "$fgSubtle"}
      aria-label={label}
    >
      {/* transition, not `animation`: v5's config drives the thumb the same way
          the toast slides in */}
      <Switch.Thumb transition="quick" backgroundColor="#fff" />
    </Switch>
  );
}

/**
 * Judul seksi di atas sebuah <Group>, mengikuti One UI: rata kiri dengan teks di
 * dalam kartunya (bukan dengan tepi kartunya), berukuran sedang dan berwarna
 * $accent. Samsung memakai warna aksen di sini justru karena labelnya kecil —
 * abu-abu 11px yang dipakai sebelumnya hilang di antara dua kartu putih.
 *
 * Sentence case, bukan HURUF BESAR SEMUA: One UI menulis "Keamanan dan privasi".
 */
export const GroupLabel = styled(Text, {
  fontSize: 13,
  fontWeight: "600",
  color: "$accent",
  marginLeft: 20,
  letterSpacing: 0.1,
});

/**
 * Sekelompok <Row> dalam satu kartu membulat — bentuk yang diulang One UI di
 * seluruh aplikasi Pengaturan-nya.
 *
 * Tiga hal yang membuatnya One UI dan bukan "daftar dengan kartu":
 *
 * 1. Radius 26. Angka itu bukan selera: One UI memakai sudut yang jauh lebih
 *    besar daripada Material, dan pada kartu selebar layar radius 16 terbaca
 *    sebagai persegi yang ujungnya sedikit tumpul.
 * 2. Tidak ada garis pemisah antarbaris. Pemisahnya jarak dan tinggi baris.
 *    Garis 1px di antara baris adalah kebiasaan iOS/Material; One UI melepasnya,
 *    dan itu yang membuat satu kartu terbaca sebagai satu blok utuh.
 * Garis tepi dan bayangannya tetap mengikuti <Card>: One UI murni memisahkan
 * kartu dari halaman lewat nada permukaan saja, tapi setiap layar lain di
 * aplikasi ini bergaris — dan satu halaman tanpa garis di antaranya terbaca
 * sebagai kartu yang gagal dirender, bukan sebagai gaya.
 *
 * Anaknya dihitung lebih dulu supaya grup yang seluruh barisnya ternyata `null`
 * (mis. Keamanan pada perangkat tanpa biometrik) tidak meninggalkan kartu kosong
 * setinggi 12px di tengah halaman.
 */
export function Group({
  label,
  children,
  ...rest
}: { label?: string; children: ReactNode } & ComponentProps<typeof YStack>) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  return (
    <YStack gap={9} {...rest}>
      {label ? <GroupLabel>{label}</GroupLabel> : null}
      <Card padding={0} paddingVertical={6} borderRadius={26} overflow="hidden">
        {rows}
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
/**
 * Ubin ikon berwarna — kotak membulat berisi satu ikon Feather.
 *
 * Bentuk yang sama sudah ditulis inline di tiga tempat (baris pengaturan di
 * bawah, aksi cepat di Beranda, gerbang izin) dan rancangan Beranda yang baru
 * memakainya delapan kali dalam satu layar. Diangkat ke sini sebelum salinan
 * kesembilan lahir.
 *
 * `fg` melewati `tint()` karena @expo/vector-icons menerima string warna, bukan
 * token Tamagui — dan `tint()` sengaja selalu memakai palet terang supaya ikon di
 * dalam ubin berwarna mempertahankan hue-nya di kedua skema.
 */
export function IconTile({
  icon,
  fg = "$fgMuted",
  bg = "$inset",
  grad,
  size = 34,
  radius,
}: {
  icon: ComponentProps<typeof Feather>["name"];
  /** token warna ikon */
  fg?: string;
  /** token latar ubin; diabaikan kalau `grad` diisi */
  bg?: string;
  /** pasangan gradien dari theme.GRAD — dilukis expo-linear-gradient, yang sudah
   *  ada di dalam APK, jadi ini tetap aman dikirim lewat OTA */
  grad?: readonly [string, string];
  size?: number;
  radius?: number;
}) {
  const r = radius ?? Math.round(size * 0.3);
  return (
    <YStack
      width={size}
      height={size}
      borderRadius={r}
      backgroundColor={grad ? "transparent" : bg}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      overflow="hidden"
    >
      {grad ? (
        <LinearGradient
          position="absolute"
          width="100%"
          height="100%"
          borderRadius={r}
          colors={[...grad]}
          start={[0, 0]}
          end={[1, 1]}
        />
      ) : null}
      <Feather name={icon} size={Math.round(size * 0.5)} color={tint(fg)} />
    </YStack>
  );
}

/**
 * Kartu statistik: ubin ikon, label, nilai, dan satu baris keterangan.
 *
 * Menggantikan dua salinan yang berbeda tipis — `HeaderStat` lokal di Beranda dan
 * `Stat` lokal di Kehadiran — yang selama ini menua sendiri-sendiri.
 */
export function StatCard({
  icon,
  fg = "$accent",
  bg = "$accentSubtle",
  grad,
  label,
  value,
  sub,
  ...rest
}: {
  icon: ComponentProps<typeof Feather>["name"];
  fg?: string;
  bg?: string;
  grad?: readonly [string, string];
  label: string;
  value: string;
  sub?: string;
} & ComponentProps<typeof Card>) {
  return (
    <Card flex={1} minHeight={80} padding={12} justifyContent="center" {...rest}>
      <XStack alignItems="center" gap={8}>
        <IconTile icon={icon} fg={fg} bg={bg} grad={grad} size={52} radius={16} />
        <YStack flex={1} height={52} justifyContent="space-between">
          <Text fontSize={11.5} lineHeight={14} color="$fgMuted" numberOfLines={1}>
            {label}
          </Text>
          <Text
            fontSize={value.length > 9 ? 14.5 : 18}
            lineHeight={21}
            fontWeight="700"
            color="$fg"
            numberOfLines={1}
            letterSpacing={-0.45}
          >
            {value}
          </Text>
          {sub ? (
            <Text fontSize={10.5} lineHeight={13} color="$fgSubtle" numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </Card>
  );
}

/**
 * Cincin progres — digambar dari View biasa, tanpa satu paket pun.
 *
 * `react-native-svg` tidak terpasang di aplikasi ini, dan menambahkannya berarti
 * kode native baru: pembaruan OTA yang memuatnya akan **crash** di APK yang sudah
 * terpasang, bukan sekadar tampil salah. Jadi cincinnya memakai teknik dua
 * setengah-lingkaran: tiap sisi menjepit satu lingkaran ber-border dengan
 * `overflow:"hidden"`, lalu memutarnya sampai potongan yang terlihat persis
 * sepanjang progresnya.
 *
 * Sudut diukur searah jarum jam dari pukul 12. Sisi kanan menampilkan 0°–180°,
 * sisi kiri 180°–360°.
 *
 * ponytail: satu warna solid, bukan gradien. Gradien sejati pada busur menuntut
 * masking yang tidak ada tanpa SVG; kalau nanti benar-benar perlu, jalannya lewat
 * WebView seperti peta.tsx — bukan lewat paket baru.
 */

/**
 * Rotasi tiap busur, dalam derajat.
 *
 * Sebuah lingkaran dengan dua border bersebelahan berwarna menampakkan busur 180°.
 * Untuk sisi kanan busurnya membentang [-45°, 135°] sebelum diputar, jadi supaya
 * UJUNG-nya mendarat tepat di sudut progres θ, ia diputar θ − 135; pangkalnya
 * (θ − 180) otomatis jatuh di luar jepitan dan tidak terlihat. Sisi kiri sama
 * persis, hanya busurnya berpusat di 225°, sehingga rotasinya θ − 315.
 */
export function busurDeg(progress: number) {
  const theta = Math.max(0, Math.min(1, progress)) * 360;
  return {
    theta,
    kanan: Math.min(theta, 180) - 135,
    kiri: Math.max(theta, 180) - 315,
  };
}

if (__DEV__) {
  const eq = (got: number, want: number, apa: string) => {
    if (Math.abs(got - want) > 0.001) throw new Error(`busurDeg ${apa}: ${got} ≠ ${want}`);
  };
  // progres nol: busur kanan diputar penuh keluar dari jepitannya
  eq(busurDeg(0).kanan, -135, "kosong");
  // seperempat: ujung busur mendarat di pukul 3
  eq(busurDeg(0.25).kanan, -45, "seperempat");
  // separuh: sisi kanan terisi penuh, sisi kiri belum mulai
  eq(busurDeg(0.5).kanan, 45, "separuh kanan");
  eq(busurDeg(0.5).kiri, -135, "separuh kiri");
  // penuh: kedua sisi terisi
  eq(busurDeg(1).kiri, 45, "penuh");
  // lembur tidak boleh memutar cincin lebih dari sekali
  eq(busurDeg(2.5).theta, 360, "dipatok di 100%");
  eq(busurDeg(-1).theta, 0, "nilai negatif dipatok");
}

export function Ring({
  progress,
  size = 132,
  thickness = 12,
  colors,
  track = "$inset",
  hole = "$surface",
  children,
}: {
  /** 0..1; nilai di luar rentang dipatok, jadi lembur tidak memutar cincin dua kali */
  progress: number;
  size?: number;
  thickness?: number;
  /** pasangan gradien dari theme.GRAD */
  colors: readonly [string, string];
  track?: string;
  /**
   * Warna lubang di tengah — HARUS sama dengan latar tempat cincin ini berdiri.
   *
   * ponytail: cincinnya dibuat dengan cara menutup tengah sebuah cakram, bukan
   * dengan menggambar garis lengkung — garis lengkung tidak bisa bergradien.
   * Konsekuensinya cincin ini hanya benar di atas bidang berwarna rata. Kalau
   * suatu saat ia harus berdiri di atas gambar atau gradien, jalannya adalah
   * SVG di dalam WebView, seperti peta.tsx.
   */
  hole?: string;
  children?: ReactNode;
}) {
  const half = size / 2;
  const { theta, kanan, kiri } = busurDeg(progress);

  /**
   * Satu juring: cakram bergradien yang separuhnya dijepit induknya, lalu diputar.
   *
   * `borderWidth = half` membuat "border" bertemu di titik pusat, sehingga
   * bentuknya menjadi cakram utuh alih-alih cincin — dan cakram itulah yang bisa
   * diisi gradien. Lubang di tengahnya ditutup belakangan.
   */
  const Juring = ({ deg, warna, sisi }: { deg: number; warna: string; sisi: "kiri" | "kanan" }) => (
    <YStack
      position="absolute"
      width={half}
      height={size}
      left={sisi === "kanan" ? half : 0}
      overflow="hidden"
    >
      <YStack
        width={size}
        height={size}
        borderRadius={half}
        borderWidth={half}
        position="absolute"
        left={sisi === "kanan" ? -half : 0}
        borderTopColor={sisi === "kanan" ? warna : "transparent"}
        borderRightColor={sisi === "kanan" ? warna : "transparent"}
        borderBottomColor={sisi === "kiri" ? warna : "transparent"}
        borderLeftColor={sisi === "kiri" ? warna : "transparent"}
        transform={[{ rotate: `${deg}deg` }]}
      />
    </YStack>
  );

  return (
    <YStack width={size} height={size} alignItems="center" justifyContent="center">
      {/* jalur: cincin polos, digambar dengan border biasa karena ia satu warna */}
      <YStack
        position="absolute"
        width={size}
        height={size}
        borderRadius={half}
        borderWidth={thickness}
        borderColor={track}
      />
      {/* dua juring, masing-masing satu ujung gradien — warna berpindah tepat di
          pukul 6, tempat kedua sisi bertemu */}
      {theta > 0 ? <Juring deg={kanan} warna={colors[0]} sisi="kanan" /> : null}
      {theta > 180 ? <Juring deg={kiri} warna={colors[1]} sisi="kiri" /> : null}
      {/* lubangnya: menutup pusat cakram dan menyisakan cincin */}
      <YStack
        position="absolute"
        width={size - thickness * 2}
        height={size - thickness * 2}
        borderRadius={half}
        backgroundColor={hole}
      />
      {children}
    </YStack>
  );
}

/** Judul kartu dengan aksi di kanan — "Rekan hadir hari ini · Lihat tim". */
export function CardHead({
  title,
  action,
  onAction,
  right,
}: {
  title: string;
  /** teks tautan di kanan; `right` menang kalau keduanya diisi */
  action?: string;
  onAction?: () => void;
  right?: ReactNode;
}) {
  return (
    <XStack alignItems="center" justifyContent="space-between" gap={10}>
      <SectionLabel numberOfLines={1} flexShrink={1}>
        {title}
      </SectionLabel>
      {right ??
        (action ? (
          <Text
            fontSize={12.5}
            fontWeight="600"
            color="$accent"
            onPress={onAction}
            pressStyle={{ opacity: 0.6 }}
            accessibilityRole="button"
          >
            {action}
          </Text>
        ) : null)}
    </XStack>
  );
}

/**
 * Satu baris di dalam <Group>.
 *
 * Ukurannya mengikuti One UI, dan angkanya berbeda cukup jauh dari sebelumnya
 * untuk perlu disebut: tinggi minimum 64 (dari 54), sisi 20 (dari 14), judul 15,5
 * (dari 13,5). One UI memang lapang — ia menukar jumlah baris yang muat di satu
 * layar dengan baris yang bisa ditekan tanpa melihat, dan itu tukar-tambah yang
 * benar untuk layar yang dibuka sambil berjalan ke kantor.
 *
 * Latarnya transparan, bukan $surface: kartu di <Group> yang memegang warnanya,
 * jadi baris pertama dan terakhir ikut membulat bersama kartunya. Yang ditekan
 * memakai $inset — One UI menggelapkan barisnya, bukan mengangkatnya.
 */
export function Row({
  label,
  labelTone = "$fg",
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
  /** token — baris yang merusak sesuatu (keluar dari akun) memakai $danger */
  labelTone?: string;
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
      minHeight={64}
      paddingHorizontal={20}
      paddingVertical={13}
      alignItems="center"
      gap={16}
      opacity={disabled ? 0.45 : 1}
      onPress={live ? onPress : undefined}
      pressStyle={live ? { backgroundColor: "$inset" } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      aria-label={note ? `${label}. ${note}` : label}
    >
      {icon ? <IconTile icon={icon} fg={iconFg} bg={iconBg} size={38} radius={13} /> : null}

      <YStack flex={1} gap={3}>
        <Text fontSize={15} fontWeight="500" color={labelTone} lineHeight={20}>
          {label}
        </Text>
        {note ? (
          <Text fontSize={12.5} color={noteTone} lineHeight={17}>
            {note}
          </Text>
        ) : null}
      </YStack>

      {loading ? <Spinner size="small" color="$fgSubtle" /> : right}
      {value && !loading ? (
        <Text fontSize={13.5} color="$fgSubtle" maxWidth={130} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron ? (
        <Feather name="chevron-right" size={18} color={tint("$fgSubtle")} />
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
 * Tombol kembali untuk layar yang tinggal DI DALAM navigator tab — berkas,
 * profil, tentang, absen: semuanya `<Tabs.Screen href={null}>`, bukan layar di
 * atas sebuah tumpukan.
 *
 * Bukan `router.back()`, dan itu inti perbaikannya. Di dalam navigator tab
 * "kembali" bukan pop sebuah tumpukan: tujuannya ditentukan `backBehavior`, dan
 * ketika riwayat tab-nya habis GO_BACK naik ke <Stack> di root — yang hanya
 * berisi `(tabs)`. Mengeluarkannya dari sana menyisakan Stack tanpa satu layar
 * pun: warna jendela Android polos, tanpa jalan kembali selain menutup
 * aplikasi. Itu layar putih kosong sesudah menekan kembali dari Profil.
 *
 * `router.navigate(tab)` tidak bergantung pada riwayat sama sekali — ia selalu
 * mendarat di tab pemiliknya, termasuk ketika layar ini dibuka langsung lewat
 * deep link, kasus yang dulu ditebak dengan `canGoBack()`.
 *
 * Tombol kembali perangkat keras diikat ke fungsi yang sama, dan hanya selama
 * layarnya fokus: BackHandler itu global, jadi pendaftaran tanpa syarat akan
 * membajak tombol kembali di keempat tab lainnya.
 */
export function useTabBack(tab: Href) {
  const router = useRouter();
  const focused = useIsFocused();
  const kembali = useCallback(() => router.navigate(tab), [router, tab]);
  useAndroidBack(focused, kembali);
  return kembali;
}

/**
 * The keyboard's height while it is up, 0 otherwise.
 *
 * <KeyboardAvoidingView> used to do this job and no longer can: Android is
 * edge-to-edge since SDK 54, so the window keeps its full height when the
 * keyboard appears (`adjustResize` in the manifest is inert under it) and the
 * keyboard simply covers the bottom of the screen — the submit button. The
 * measurement the events carry is the one thing that still describes it, and
 * turning it into padding is less code than a keyboard library.
 */
export function useKeyboardHeight() {
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
  const keyboard = useKeyboardHeight();
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
        /**
         * The sheet keeps its snap point when the keyboard opens, so the keyboard
         * lands on top of its lower third — the footer, and whichever field sits
         * there. Padding the frame by that height lifts the footer clear and
         * shortens the scrolling middle by exactly as much, which is what makes
         * the focused field reachable instead of buried.
         */
        paddingBottom={keyboard}
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
            // the 26px is the home indicator's clearance, which the keyboard covers
            paddingBottom={keyboard ? 14 : 26}
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

/** One native animation drives every mounted skeleton block. The Home placeholder
 * contains dozens of blocks; creating a native loop for each one caused a burst
 * of bridge/animation allocations exactly while the initial query was pending. */
const skeletonPulse = new Animated.Value(0.45);
let pulseUsers = 0;
let pulseLoop: ReturnType<typeof Animated.loop> | null = null;

function usePulse() {
  useEffect(() => {
    pulseUsers += 1;
    if (pulseUsers === 1) {
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(skeletonPulse, { toValue: 1, duration: 620, useNativeDriver: true }),
          Animated.timing(skeletonPulse, {
            toValue: 0.45,
            duration: 620,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.start();
    }
    return () => {
      pulseUsers -= 1;
      if (pulseUsers === 0) {
        pulseLoop?.stop();
        pulseLoop = null;
        skeletonPulse.setValue(0.45);
      }
    };
  }, []);

  return skeletonPulse;
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
