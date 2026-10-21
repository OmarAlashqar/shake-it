import { GIFEncoder, quantize, applyPalette } from "gifenc";

export type ShakeStyle = "shake" | "rotate" | "zoom" | "chaos";

export const SHAKE_STYLES: { value: ShakeStyle; label: string; hint: string }[] = [
  { value: "shake", label: "Shake", hint: "Classic jitter — the \"intensifies\" look" },
  { value: "rotate", label: "Wobble", hint: "Rocks back and forth" },
  { value: "zoom", label: "Pulse", hint: "Throbs in and out" },
  { value: "chaos", label: "Chaos", hint: "Everything at once" },
];

export interface ShakeSettings {
  style: ShakeStyle;
  /** 0..1 */
  intensity: number;
  /** frames per second */
  fps: number;
  /** total frames in the loop */
  frames: number;
  /** output square size in px */
  size: number;
}

export const DEFAULT_SETTINGS: ShakeSettings = {
  style: "shake",
  intensity: 0.6,
  fps: 18,
  frames: 12,
  size: 128,
};

export interface FrameTransform {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

/** Deterministic PRNG so the live preview and exported GIF line up exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Precompute the per-frame transforms for a given set of settings. Using a
 * fixed seed keeps the motion identical between what the user previews and what
 * actually gets encoded into the GIF.
 */
export function computeTransforms(settings: ShakeSettings): FrameTransform[] {
  const { style, intensity, frames, size } = settings;
  const rand = mulberry32(1337);
  const amp = intensity * size * 0.16;
  const maxAngle = intensity * 0.5; // radians
  const zoomAmt = intensity * 0.35;

  const out: FrameTransform[] = [];
  for (let i = 0; i < frames; i++) {
    const phase = (i / frames) * Math.PI * 2;
    let dx = 0;
    let dy = 0;
    let rot = 0;
    let scale = 1;

    switch (style) {
      case "shake":
        dx = (rand() * 2 - 1) * amp;
        dy = (rand() * 2 - 1) * amp;
        break;
      case "rotate":
        rot = Math.sin(phase) * maxAngle;
        dx = (rand() * 2 - 1) * amp * 0.15;
        break;
      case "zoom":
        scale = 1 + Math.abs(Math.sin(phase)) * zoomAmt;
        break;
      case "chaos":
        dx = (rand() * 2 - 1) * amp;
        dy = (rand() * 2 - 1) * amp;
        rot = (rand() * 2 - 1) * maxAngle;
        scale = 1 + (rand() - 0.5) * zoomAmt;
        break;
    }

    out.push({ dx, dy, rot, scale });
  }
  return out;
}

export interface FitResult {
  drawW: number;
  drawH: number;
}

/**
 * Fit the source into the largest centered box that still keeps the moving
 * image inside the frame. The headroom is derived from the actual worst-case
 * transform for the chosen style/intensity (translation, rotation, scale)
 * rather than a fixed margin, so the image fills as much of the frame as the
 * motion allows instead of floating in empty space.
 */
export function fitContent(
  srcW: number,
  srcH: number,
  settings: ShakeSettings,
): FitResult {
  const { size, intensity, style } = settings;
  // Keep these in step with computeTransforms.
  const ampFrac = intensity * 0.16; // peak per-axis shift, as a fraction of size
  const maxAngle = intensity * 0.5; // radians
  const zoomAmt = intensity * 0.35;

  let translateFrac = 0;
  let angle = 0;
  let scale = 1;
  switch (style) {
    case "shake":
      translateFrac = ampFrac;
      break;
    case "rotate":
      translateFrac = ampFrac * 0.15;
      angle = maxAngle;
      break;
    case "zoom":
      scale = 1 + zoomAmt;
      break;
    case "chaos":
      translateFrac = ampFrac;
      angle = maxAngle;
      scale = 1 + zoomAmt * 0.5;
      break;
  }

  // A box of side B, scaled and rotated, has a half-extent of
  // scale * (B/2) * (|cos| + |sin|); add the translation, keep it within size/2.
  const rotFactor = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle));
  const safety = 0.96;
  const boxFrac = Math.max(
    0.3,
    Math.min(1, ((1 - 2 * translateFrac) / (scale * rotFactor)) * safety),
  );

  const box = size * boxFrac;
  const ratio = Math.min(box / srcW, box / srcH);
  return { drawW: srcW * ratio, drawH: srcH * ratio };
}

/** Draw a single frame of the animation onto a 2D context. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  fit: FitResult,
  size: number,
  t: FrameTransform,
) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2 + t.dx, size / 2 + t.dy);
  ctx.rotate(t.rot);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(img, -fit.drawW / 2, -fit.drawH / 2, fit.drawW, fit.drawH);
  ctx.restore();
}

/** Force partial-alpha edge pixels to fully on/off for clean GIF transparency. */
function hardenAlpha(data: Uint8ClampedArray) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) {
      data[i - 3] = 0;
      data[i - 2] = 0;
      data[i - 1] = 0;
      data[i] = 0;
    } else {
      data[i] = 255;
    }
  }
}

export interface GifResult {
  blob: Blob;
  url: string;
  bytes: number;
}

/**
 * Render every frame and encode an animated, transparent GIF. All frames share
 * a single palette (the pixels are the same image, only repositioned) which
 * keeps the file small and avoids inter-frame color flicker.
 */
export async function generateGif(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  settings: ShakeSettings,
): Promise<GifResult> {
  const { size, fps } = settings;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get a 2D canvas context.");

  const fit = fitContent(srcW, srcH, settings);
  const transforms = computeTransforms(settings);
  const delay = Math.round(1000 / fps);
  const format = "rgba4444";
  const gif = GIFEncoder();

  let palette: number[][] | null = null;
  for (const t of transforms) {
    drawFrame(ctx, img, fit, size, t);
    const { data } = ctx.getImageData(0, 0, size, size);
    hardenAlpha(data);
    if (!palette) {
      palette = quantize(data, 256, { format, oneBitAlpha: true });
    }
    const index = applyPalette(data, palette, format);
    gif.writeFrame(index, size, size, {
      palette,
      delay,
      transparent: true,
    });
    // Yield so the UI thread can update progress on large/slow renders.
    await Promise.resolve();
  }

  gif.finish();
  // Copy into a fresh ArrayBuffer-backed view so it satisfies BlobPart.
  const bytes = new Uint8Array(gif.bytesView());
  const blob = new Blob([bytes], { type: "image/gif" });
  return { blob, url: URL.createObjectURL(blob), bytes: blob.size };
}
