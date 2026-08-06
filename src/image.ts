import { requireOptionalNativeModule } from "expo";
import type { ImageResult } from "expo-image-manipulator";

/**
 * Turning a camera roll picture into something worth uploading.
 *
 * Shared by the clock-in selfie (3:4, 720px) and the profile photo (1:1, 512px),
 * which differ only in those two numbers — the cropping arithmetic, the format and
 * the reason for it are the same, and having written it twice would have meant
 * fixing an off-by-one twice.
 */

/**
 * Whether this binary was built with expo-image-manipulator in it.
 *
 * Asked before importing, not caught after: the module throws from its own module
 * scope, so even `await import()` inside a try only moves the explosion — Metro
 * evaluates the chunk and the throw surfaces as a redbox with no way back. This
 * asks the question without loading anything, and returns null instead of throwing
 * on a dev build made before the package was installed.
 */
export const canProcessImages = () =>
  requireOptionalNativeModule("ExpoImageManipulator") !== null;

/**
 * Centre-crop to `ratio` (width ÷ height), downscale, save as WebP.
 *
 * Cropped here rather than through the picker's editor: a crop screen is another
 * step between somebody and the thing they meant to do, and the middle of a
 * portrait is the face every time.
 *
 * WebP because these are stored forever — a punch every working day per employee,
 * a profile photo per person — and because it is the Android encoder's own format,
 * which is the only platform this app ships to (app.json `platforms`).
 */
export async function toWebp(
  asset: { uri: string; width: number; height: number },
  { ratio, width, compress = 0.6 }: { ratio: number; width: number; compress?: number },
): Promise<ImageResult> {
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const ctx = ImageManipulator.manipulate(asset.uri);

  // wider than the target → trim the sides; taller → trim top and bottom
  if (asset.width / asset.height > ratio) {
    const w = Math.round(asset.height * ratio);
    ctx.crop({
      originX: Math.round((asset.width - w) / 2),
      originY: 0,
      width: w,
      height: asset.height,
    });
  } else {
    const h = Math.round(asset.width / ratio);
    ctx.crop({
      originX: 0,
      originY: Math.round((asset.height - h) / 2),
      width: asset.width,
      height: h,
    });
  }

  ctx.resize({ width });
  const rendered = await ctx.renderAsync();
  return rendered.saveAsync({ format: SaveFormat.WEBP, compress });
}
