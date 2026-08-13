import { Image } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, YStack } from "tamagui";
import { type Bootstrap, get } from "@/api";
import { Card, Group, Note, PageHeader, Row, Screen } from "@/ui";

/**
 * "Tentang aplikasi" — what this build is, and which office and shift it reports
 * to. Read-only by definition, which is why it is a page under Pengaturan rather
 * than a group of rows in it.
 *
 * The version comes from app.json and the build identity from expo-updates:
 * `updateId` is the only build number this app has, since it ships over OTA and
 * `runtimeVersion` follows the app version by policy.
 */
export default function Tentang() {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Bootstrap>("/api/me") });
  const version = Constants.expoConfig?.version ?? "—";
  const build = Updates.isEmbeddedLaunch
    ? "bawaan build"
    : (Updates.updateId?.slice(0, 8) ?? "—");

  return (
    <Screen>
      <PageHeader
        title="Tentang"
        subtitle="Versi aplikasi dan perusahaan"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/pengaturan"))}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28, gap: 19 }}>
        <Card padding={16} alignItems="center" gap={3}>
          <YStack
            width={44}
            height={44}
            borderRadius={13}
            backgroundColor="$accentSubtle"
            alignItems="center"
            justifyContent="center"
            marginBottom={7}
          >
            <Image
              source={require("../../../assets/logo-mark.png")}
              style={{ width: 32, height: 32 }}
              resizeMode="contain"
              accessibilityLabel="Logo NanumHR"
            />
          </YStack>
          <Text fontSize={15} fontWeight="700" color="$fg">
            NanumHR
          </Text>
          <Text fontSize={12} color="$fgMuted" textAlign="center" lineHeight={18}>
            Absensi, cuti dan lembur untuk karyawan · versi {version}
          </Text>
        </Card>

        <Group label="Aplikasi">
          <Row label="Versi" value={version} />
          <Row label="Build" value={build} />
          <Row label="Paket" value={Constants.expoConfig?.android?.package ?? "—"} />
        </Group>

        {me.data ? (
          <Group label="Perusahaan">
            <Row
              label="Jam kerja"
              value={`${me.data.shift.start.slice(0, 5)}–${me.data.shift.end.slice(0, 5)}`}
            />
            <Row
              label="Toleransi keterlambatan"
              value={`${me.data.shift.toleranceMinutes} menit`}
            />
            {/* one row per office: the geofence is per-location now, so a single
                "radius absen" figure would be true for at most one of them */}
            {me.data.offices.map((o) => (
              <Row key={o.id} label={o.name} value={`radius ${o.radiusM} m`} />
            ))}
          </Group>
        ) : null}

        <Note text="Kebijakan absensi, cuti dan penyimpanan data mengikuti aturan yang berlaku di perusahaan Anda. Hubungi tim HR untuk salinan dokumennya." />
      </ScrollView>
    </Screen>
  );
}
