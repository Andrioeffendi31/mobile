import { useMemo, useState } from "react";
import { FlatList, Modal, RefreshControl, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useIsFocused } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Image, Spinner, Text, XStack, YStack, useTheme } from "tamagui";
import { API, type Documents, get, postForm } from "@/api";
import { toast } from "@/toast";
import {
  Btn,
  Empty,
  ErrorNote,
  Mono,
  PageHeader,
  Screen,
  Skeleton,
  useAndroidBack,
  useTabBack,
} from "@/ui";

type DocumentItem = Documents["items"][number];
type Preview = { doc: DocumentItem; url: string; kind: "image" | "pdf" };

const IMAGE_EXTENSIONS = new Set(["JPG", "JPEG", "PNG", "WEBP", "GIF"]);
const fileKind = (doc: DocumentItem) => {
  const ext = doc.ext.toUpperCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image" as const;
  if (ext === "PDF") return "pdf" as const;
  return "external" as const;
};

/** "Berkas saya" — personal and company documents inside Pengaturan. */
export default function Berkas() {
  const back = useTabBack("/pengaturan");
  const theme = useTheme();
  const isFocused = useIsFocused();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const q = useQuery({
    queryKey: ["documents"],
    queryFn: ({ signal }) => get<Documents>("/api/me/documents", { signal }),
    enabled: isFocused,
  });

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const open = useMutation({
    mutationFn: async (doc: DocumentItem) => {
      setBusyId(doc.id);
      const kind = fileKind(doc);
      const query = kind === "external" ? "json=1" : "json=1&inline=1";
      const { url } = await get<{ url: string }>(`/api/files/${doc.key}?${query}`);
      return { doc, url, kind };
    },
    onSuccess: async (result) => {
      if (result.kind === "external") {
        await Linking.openURL(result.url);
        return;
      }
      setPreview({ doc: result.doc, url: result.url, kind: result.kind });
    },
    onError: (error) => toast((error as Error).message),
    onSettled: () => setBusyId(null),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (picked.canceled) return null;
      const file = picked.assets[0];
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      return postForm<{ id: number }>("/api/me/documents", form);
    },
    onSuccess: async (result) => {
      if (!result) return;
      await qc.invalidateQueries({ queryKey: ["documents"] });
      toast("Berkas terunggah");
    },
    onError: (error) => toast((error as Error).message),
  });

  const items = q.data?.items ?? [];
  const personal = items.filter((item) => item.mine).length;
  const company = items.length - personal;

  return (
    <Screen>
      <PageHeader
        title="Berkas saya"
        subtitle="Dokumen pribadi dan perusahaan"
        onBack={back}
      />

      <FlatList
        data={q.isPending || q.isError ? [] : items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={9}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <YStack gap={13} paddingBottom={11}>
            <XStack minHeight={130} gap={9}>
              <YStack
                width="42%"
                borderRadius={27}
                backgroundColor="$accentFill"
                padding={15}
                justifyContent="space-between"
                overflow="hidden"
              >
                <YStack
                  position="absolute"
                  width={92}
                  height={92}
                  borderRadius={46}
                  right={-28}
                  top={-28}
                  backgroundColor="rgba(255,255,255,.10)"
                  pointerEvents="none"
                />
                <YStack
                  width={34}
                  height={34}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="rgba(255,255,255,.15)"
                >
                  <Feather name="folder" size={17} color="#fff" />
                </YStack>
                <YStack gap={1}>
                  <XStack alignItems="baseline" gap={5}>
                    <Mono fontSize={35} lineHeight={39} fontWeight="700" color="$accentFg">
                      {q.data ? items.length : "—"}
                    </Mono>
                    <Text fontSize={11} fontWeight="600" color="$accentFg" opacity={0.76}>
                      berkas
                    </Text>
                  </XStack>
                  <Text fontSize={9.5} color="$accentFg" opacity={0.7}>
                    Tersimpan aman
                  </Text>
                </YStack>
              </YStack>

              <YStack flex={1} gap={8}>
                <FileStat
                  icon="user"
                  label="Berkas pribadi"
                  value={personal}
                  tone="accent"
                />
                <FileStat
                  icon="briefcase"
                  label="Dari perusahaan"
                  value={company}
                  tone="info"
                />
              </YStack>
            </XStack>

            <XStack
              alignItems="center"
              gap={10}
              borderRadius={18}
              backgroundColor="$infoSubtle"
              paddingHorizontal={13}
              paddingVertical={11}
            >
              <YStack
                width={32}
                height={32}
                borderRadius={13}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$surface"
              >
                <Feather name="lock" size={14} color={theme.info?.val} />
              </YStack>
              <Text flex={1} fontSize={10.5} lineHeight={15} color="$info">
                Berkas pribadi hanya dapat dilihat oleh Anda dan tim HR.
              </Text>
            </XStack>

            <XStack alignItems="center" justifyContent="space-between" marginTop={2}>
              <Text fontSize={16.5} lineHeight={21} fontWeight="700" color="$fg">
                Daftar berkas
              </Text>
              <Text fontSize={11.5} color="$fgSubtle">
                Ketuk untuk melihat
              </Text>
            </XStack>
          </YStack>
        }
        ListEmptyComponent={
          q.isPending ? (
            <DocumentSkeleton />
          ) : q.isError ? (
            <ErrorNote message={(q.error as Error).message} onRetry={q.refetch} />
          ) : (
            <Empty text="Belum ada berkas. Unggah dokumen pertama Anda." />
          )
        }
        renderItem={({ item, index }) => {
          const openable = Boolean(item.key);
          const busy = busyId === item.id;
          const kind = fileKind(item);
          const last = index === items.length - 1;
          return (
            <XStack
              minHeight={78}
              alignItems="center"
              gap={12}
              paddingHorizontal={14}
              paddingVertical={11}
              backgroundColor="$surface"
              borderWidth={1}
              borderBottomWidth={last ? 1 : 0}
              borderColor="$line"
              borderTopLeftRadius={index === 0 ? 24 : 0}
              borderTopRightRadius={index === 0 ? 24 : 0}
              borderBottomLeftRadius={last ? 24 : 0}
              borderBottomRightRadius={last ? 24 : 0}
              opacity={openable ? 1 : 0.52}
              pressStyle={openable && !busy ? { backgroundColor: "$surface2" } : undefined}
              onPress={openable && !busy ? () => open.mutate(item) : undefined}
              accessibilityRole={openable ? "button" : undefined}
              accessibilityState={{ disabled: !openable, busy }}
              aria-label={`${kind === "external" ? "Buka" : "Pratinjau"} ${item.name}, ${item.size}`}
            >
              <FileTile ext={item.ext} />
              <YStack flex={1} gap={3}>
                <Text fontSize={13} lineHeight={18} fontWeight="600" color="$fg">
                  {item.name}
                </Text>
                <Text fontSize={10.5} lineHeight={15} color="$fgSubtle">
                  {item.size} · {item.mine ? "Pribadi" : "Dokumen perusahaan"}
                </Text>
              </YStack>
              {busy ? (
                <Spinner size="small" color="$fgSubtle" />
              ) : (
                <YStack
                  width={34}
                  height={34}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="$inset"
                >
                  <Feather
                    name={!openable ? "slash" : kind === "external" ? "external-link" : "eye"}
                    size={15}
                    color={theme.fgMuted?.val}
                  />
                </YStack>
              )}
            </XStack>
          );
        }}
      />

      <YStack
        paddingHorizontal={18}
        paddingTop={12}
        paddingBottom={13}
        backgroundColor="$surface"
        borderTopWidth={1}
        borderTopColor="$line"
      >
        <Btn
          height={50}
          borderRadius={17}
          disabled={upload.isPending}
          onPress={() => upload.mutate()}
          icon={<Feather name="upload-cloud" size={17} color={theme.accentFg?.val} />}
        >
          {upload.isPending ? "Mengunggah…" : "Unggah berkas baru"}
        </Btn>
      </YStack>

      <FilePreview preview={preview} onClose={() => setPreview(null)} />
    </Screen>
  );
}

function FileStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: "user" | "briefcase";
  label: string;
  value: number;
  tone: "accent" | "info";
}) {
  const theme = useTheme();
  const accent = tone === "accent" ? theme.accent?.val : theme.info?.val;
  return (
    <XStack
      flex={1}
      minHeight={61}
      alignItems="center"
      gap={10}
      borderRadius={20}
      borderWidth={1}
      borderColor="$line"
      backgroundColor="$surface"
      paddingHorizontal={11}
    >
      <YStack
        width={31}
        height={31}
        borderRadius={12}
        alignItems="center"
        justifyContent="center"
        backgroundColor={tone === "accent" ? "$accentSubtle" : "$infoSubtle"}
      >
        <Feather name={icon} size={14} color={accent} />
      </YStack>
      <YStack flex={1} gap={1}>
        <Mono fontSize={16} lineHeight={19} fontWeight="700">
          {value}
        </Mono>
        <Text fontSize={9.5} lineHeight={12} color="$fgSubtle">
          {label}
        </Text>
      </YStack>
    </XStack>
  );
}

function FileTile({ ext }: { ext: string }) {
  const pdf = ext.toUpperCase() === "PDF";
  return (
    <YStack
      width={46}
      height={46}
      borderRadius={16}
      alignItems="center"
      justifyContent="center"
      backgroundColor={pdf ? "$dangerSubtle" : "$infoSubtle"}
    >
      <Feather name={pdf ? "file-text" : "image"} size={17} color={pdf ? "$danger" : "$info"} />
      <Mono fontSize={7.5} lineHeight={10} fontWeight="700" color={pdf ? "$danger" : "$info"}>
        {ext.slice(0, 4).toUpperCase()}
      </Mono>
    </YStack>
  );
}

function DocumentSkeleton() {
  return (
    <YStack borderRadius={24} overflow="hidden" borderWidth={1} borderColor="$line">
      {[0, 1, 2, 3].map((item) => (
        <XStack
          key={item}
          minHeight={78}
          alignItems="center"
          gap={12}
          padding={14}
          backgroundColor="$surface"
          borderBottomWidth={item === 3 ? 0 : 1}
          borderBottomColor="$line"
        >
          <Skeleton width={46} height={46} radius={16} />
          <YStack flex={1} gap={8}>
            <Skeleton width="72%" height={11} />
            <Skeleton width="48%" height={9} />
          </YStack>
          <Skeleton width={34} height={34} radius={14} />
        </XStack>
      ))}
    </YStack>
  );
}

function FilePreview({ preview, onClose }: { preview: Preview | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  useAndroidBack(preview !== null, onClose);

  const openExternal = async () => {
    if (!preview) return;
    try {
      await Linking.openURL(preview.url);
    } catch (error) {
      toast((error as Error).message);
    }
  };

  return (
    <Modal
      visible={preview !== null}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
        <XStack
          minHeight={62}
          alignItems="center"
          gap={9}
          paddingHorizontal={12}
          borderBottomWidth={1}
          borderBottomColor="$line"
          backgroundColor="$surface"
        >
          <YStack
            width={40}
            height={40}
            borderRadius={16}
            alignItems="center"
            justifyContent="center"
            onPress={onClose}
            pressStyle={{ backgroundColor: "$inset", scale: 0.96 }}
            accessibilityRole="button"
            aria-label="Tutup pratinjau"
          >
            <Feather name="chevron-left" size={23} color={theme.fg?.val} />
          </YStack>
          <YStack flex={1} gap={1}>
            <Text fontSize={13.5} lineHeight={18} fontWeight="600" color="$fg">
              {preview?.doc.name ?? "Pratinjau berkas"}
            </Text>
            <Text fontSize={10.5} color="$fgSubtle">
              {preview ? `${preview.doc.ext} · ${preview.doc.size}` : ""}
            </Text>
          </YStack>
          <YStack
            width={40}
            height={40}
            borderRadius={16}
            alignItems="center"
            justifyContent="center"
            backgroundColor="$inset"
            onPress={() => void openExternal()}
            pressStyle={{ opacity: 0.65, scale: 0.96 }}
            accessibilityRole="button"
            aria-label="Buka berkas di aplikasi lain"
          >
            <Feather name="external-link" size={17} color={theme.fgMuted?.val} />
          </YStack>
        </XStack>

        {preview?.kind === "image" ? (
          <YStack flex={1} alignItems="center" justifyContent="center" backgroundColor="$inset">
            <Image
              source={{ uri: preview.url }}
              width="100%"
              height="100%"
              resizeMode="contain"
              accessibilityLabel={`Pratinjau ${preview.doc.name}`}
            />
          </YStack>
        ) : preview?.kind === "pdf" ? (
          <PdfPreview url={preview.url} onOpenExternal={() => void openExternal()} />
        ) : null}
      </YStack>
    </Modal>
  );
}

function PdfPreview({ url, onOpenExternal }: { url: string; onOpenExternal: () => void }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const html = useMemo(
    () => pdfHtml(url, theme.bg?.val ?? "#f5f6f8", theme.fgMuted?.val ?? "#59606d"),
    [theme.bg?.val, theme.fgMuted?.val, url],
  );

  if (failed) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" padding={28} gap={13}>
        <YStack
          width={58}
          height={58}
          borderRadius={21}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$dangerSubtle"
        >
          <Feather name="file-text" size={25} color={theme.danger?.val} />
        </YStack>
        <Text fontSize={15} fontWeight="700" color="$fg" textAlign="center">
          Pratinjau PDF tidak dapat dimuat
        </Text>
        <Text fontSize={11.5} lineHeight={17} color="$fgSubtle" textAlign="center">
          Periksa koneksi, lalu buka berkas menggunakan aplikasi PDF di perangkat Anda.
        </Text>
        <Btn tone="ghost" onPress={onOpenExternal}>
          Buka di aplikasi lain
        </Btn>
      </YStack>
    );
  }

  return (
    <WebView
      // Match the API/web origin so an R2 CORS policy already used by browser
      // uploads also recognizes PDF.js' signed-URL request. A data: origin would
      // otherwise be reported as `null` and commonly rejected.
      source={{ html, baseUrl: `${API}/` }}
      style={styles.webView}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      renderLoading={() => (
        <YStack flex={1} alignItems="center" justifyContent="center" backgroundColor="$bg">
          <Spinner size="large" color="$accent" />
        </YStack>
      )}
      onMessage={(event) => {
        if (event.nativeEvent.data.startsWith("pdf-error:")) setFailed(true);
      }}
      onError={() => setFailed(true)}
      onHttpError={() => setFailed(true)}
    />
  );
}

/**
 * PDF.js runs inside the WebView already shipped in the APK. Pages are rendered
 * only as they approach the viewport, avoiding a large canvas allocation for a
 * long document. The signed document URL is fetched by the WebView itself and is
 * never handed to a third-party document viewer.
 */
function pdfHtml(url: string, background: string, muted: string) {
  const file = JSON.stringify(url).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4,user-scalable=yes">
<style>
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:${background};color:${muted};font-family:system-ui,sans-serif}
  #status{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;z-index:2;background:${background}}
  #pages{padding:12px}.page{margin:0 auto 12px;background:white;box-shadow:0 2px 12px rgba(0,0,0,.12);overflow:hidden;min-height:180px}
  canvas{display:block;width:100%;height:auto}
</style></head><body><div id="status">Memuat PDF…</div><main id="pages"></main>
<script type="module">
  const notify=(message)=>window.ReactNativeWebView?.postMessage('pdf-error:'+message);
  try {
    const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({url:${file}}).promise;
    const host=document.getElementById('pages');
    const jobs=[];
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number);
      const base=page.getViewport({scale:1});
      const shell=document.createElement('section');
      shell.className='page'; shell.style.aspectRatio=base.width+'/'+base.height;
      shell.dataset.page=String(number); host.appendChild(shell); jobs.push([shell,page,base]);
    }
    document.getElementById('status').remove();
    const observer=new IntersectionObserver((entries)=>entries.forEach(async(entry)=>{
      if(!entry.isIntersecting||entry.target.dataset.rendered)return;
      const [shell,page,base]=jobs[Number(entry.target.dataset.page)-1];
      shell.dataset.rendered='1'; observer.unobserve(shell);
      const cssWidth=Math.max(280,shell.clientWidth); const scale=Math.min(2,(cssWidth/base.width)*1.55);
      const viewport=page.getViewport({scale}); const canvas=document.createElement('canvas');
      canvas.width=viewport.width; canvas.height=viewport.height; shell.appendChild(canvas);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    }),{rootMargin:'700px 0px'});
    jobs.forEach(([shell])=>observer.observe(shell));
  } catch(error) { document.getElementById('status').textContent='PDF tidak dapat dimuat'; notify(error?.message||'unknown'); }
</script></body></html>`;
}

const styles = StyleSheet.create({ webView: { flex: 1, backgroundColor: "transparent" } });
