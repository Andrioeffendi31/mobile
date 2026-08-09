import { useEffect, useRef, useState } from "react";
import { WebView } from "react-native-webview";
import { Text, YStack } from "tamagui";

/**
 * A map, from the same OpenFreeMap tiles the web app draws.
 *
 * MapLibre inside a WebView rather than @maplibre/maplibre-react-native. Both need
 * a native rebuild, so that is not the deciding factor — the deciding factor is
 * that this app draws exactly two maps, both read-only pictures of state, and the
 * native binding brings a second map engine, its own style/annotation API and its
 * own upgrade treadmill to do what 60 lines of the engine the web app already uses
 * does identically. The tone names, the geofence maths and the trail rule below
 * are deliberately the same as web/src/components/peta-map.tsx.
 *
 * The map is non-interactive on purpose: it lives inside a ScrollView, and a
 * pannable map there is a gesture fight the map always wins and the page always
 * loses. Nothing here is a control — it is a picture of where you are.
 */

export type Tone = "kantor" | "masuk" | "keluar" | "ping" | "peringatan" | "saya";
export type Titik = { lat: number; lng: number; label?: string; tone?: Tone };
export type Lingkaran = { lat: number; lng: number; radiusM: number };

type Data = { points: Titik[]; circles: Lingkaran[]; trail: boolean };

/**
 * Pinned exactly, and verified by the browser against these digests — a WebView
 * with no session cookie is still our app, and a CDN that served something else
 * would be running it. unpkg rather than bundling the 1 MB library as an asset:
 * a map is useless offline anyway, so a network dependency costs nothing real.
 */
const LIB = "https://unpkg.com/maplibre-gl@5.24.0/dist";
const JS_SRI = "sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp";
const CSS_SRI = "sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK";
const STYLE = "https://tiles.openfreemap.org/styles/bright";

/** Same hex values as the web tones, spelled out because a WebView cannot read
 *  Tamagui's tokens. */
const TONE: Record<Tone, string> = {
  kantor: "#4f46e5",
  masuk: "#0f7b5a",
  keluar: "#2563eb",
  ping: "#8b93a1",
  peringatan: "#b4530b",
  saya: "#d4342c",
};

/**
 * The whole map, as one document.
 *
 * `render(data)` is defined on `window` so the React side can push new points
 * without reloading the page — a reload would flash white every time the employee
 * switches office in the picker.
 */
const page = (initial: Data) => `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<link href="${LIB}/maplibre-gl.css" rel="stylesheet" integrity="${CSS_SRI}" crossorigin="anonymous">
<style>html,body,#m{margin:0;height:100%;background:#eee}</style>
<script>
// registered before anything else loads: if the CDN is unreachable or its digest
// does not match, the library never defines maplibregl and the script below dies
// with a ReferenceError that nothing else would ever report
window.onerror = function (m) {
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage("err:" + m);
};
</script>
</head><body><div id="m"></div>
<script src="${LIB}/maplibre-gl.js" integrity="${JS_SRI}" crossorigin="anonymous"></script>
<script>
const TONE = ${JSON.stringify(TONE)};
const map = new maplibregl.Map({
  container: "m",
  style: ${JSON.stringify(STYLE)},
  center: [106.827, -6.175],
  zoom: 11,
  interactive: false,
  attributionControl: { compact: true },
});
let markers = [];

// A geofence has to keep its size in metres while the camera moves, so it is a
// polygon; MapLibre's circle radius is in screen pixels.
function ring(c) {
  const dLat = c.radiusM / 111320;
  const dLng = c.radiusM / (111320 * Math.cos(c.lat * Math.PI / 180));
  const out = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64 * 2 * Math.PI;
    out.push([c.lng + dLng * Math.cos(t), c.lat + dLat * Math.sin(t)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [out] } };
}

window.render = function (d) {
  if (!map.isStyleLoaded()) { map.once("idle", function () { window.render(d); }); return; }
  markers.forEach(function (m) { m.remove(); });
  markers = d.points.map(function (p) {
    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);background:" + (TONE[p.tone] || TONE.kantor);
    if (p.label) el.title = p.label;
    return new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
  });

  map.getSource("fence").setData({ type: "FeatureCollection", features: d.circles.map(ring) });

  // the office is a landmark, not a step in the day — a line through it would
  // claim the person walked to the pin
  const walk = d.points.filter(function (p) { return p.tone !== "kantor"; });
  map.getSource("trail").setData(d.trail && walk.length > 1
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: walk.map(function (p) { return [p.lng, p.lat]; }) } }
    : { type: "FeatureCollection", features: [] });

  // frame the edges of each fence, not its centre, or half of it sits off-screen
  const b = new maplibregl.LngLatBounds();
  d.points.forEach(function (p) { b.extend([p.lng, p.lat]); });
  d.circles.forEach(function (c) {
    const dLat = c.radiusM / 111320;
    const dLng = c.radiusM / (111320 * Math.cos(c.lat * Math.PI / 180));
    b.extend([c.lng - dLng, c.lat - dLat]);
    b.extend([c.lng + dLng, c.lat + dLat]);
  });
  if (!b.isEmpty()) map.fitBounds(b, { padding: 34, maxZoom: 17, duration: 0 });
};

map.on("load", function () {
  map.addSource("fence", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "fence-fill", type: "fill", source: "fence", paint: { "fill-color": TONE.kantor, "fill-opacity": 0.14 } });
  map.addLayer({ id: "fence-line", type: "line", source: "fence", paint: { "line-color": TONE.kantor, "line-width": 1.5 } });
  map.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "trail-line", type: "line", source: "trail", paint: { "line-color": TONE.kantor, "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.7 } });
  window.render(${JSON.stringify(initial)});
});

// otherwise every failure — tiles unreachable, style rejected, CDN digest
// mismatch — looks the same from the outside: an empty grey box
map.on("error", function (e) {
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
    "err:" + ((e.error && e.error.message) || "Peta gagal dimuat"));
});
</script></body></html>`;

export function Peta({
  points,
  circles = [],
  trail = false,
  height = 190,
}: {
  points: Titik[];
  circles?: Lingkaran[];
  trail?: boolean;
  height?: number;
}) {
  const web = useRef<WebView>(null);
  const [gagal, setGagal] = useState<string | null>(null);
  /**
   * The document is built once and then fed. Rebuilding it on every prop change
   * would reload the WebView — a white flash and a fresh tile fetch each time the
   * GPS answers or the employee picks a different office.
   */
  const [html] = useState(() => page({ points, circles, trail }));

  // Serialised, so a parent that rebuilds its arrays on every render does not
  // re-push identical points into the page.
  const data = JSON.stringify({ points, circles, trail });
  const first = useRef(true);
  useEffect(() => {
    // the initial data is already baked into the document
    if (first.current) return void (first.current = false);
    web.current?.injectJavaScript(`window.render && window.render(${data});true;`);
  }, [data]);

  return (
    <YStack height={height} borderRadius={12} overflow="hidden" backgroundColor="$inset">
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={["*"]}
        // it is a picture inside a ScrollView, so it must not eat the scroll
        scrollEnabled={false}
        // Android draws WebViews opaque white until first paint, which flashes
        // against a dark sheet
        style={{ flex: 1, backgroundColor: "transparent" }}
        onMessage={(e) => {
          const m = e.nativeEvent.data;
          if (m.startsWith("err:")) setGagal(m.slice(4));
        }}
      />
      {gagal ? (
        <YStack
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          backgroundColor="$dangerSubtle"
          paddingHorizontal={10}
          paddingVertical={7}
        >
          <Text fontSize={11.5} color="$danger">
            {gagal}
          </Text>
        </YStack>
      ) : null}
    </YStack>
  );
}
