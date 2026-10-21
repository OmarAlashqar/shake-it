"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  computeTransforms,
  DEFAULT_SETTINGS,
  drawFrame,
  fitContent,
  generateGif,
  SHAKE_STYLES,
  type GifResult,
  type ShakeSettings,
  type ShakeStyle,
} from "@/lib/shake";

const PREVIEW_SIZE = 240;
const SLACK_LIMIT = 128 * 1024; // Slack caps custom emoji at 128 KB
const OUTPUT_SIZES = [64, 128, 160];

interface LoadedImage {
  el: HTMLImageElement;
  width: number;
  height: number;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function ShakeStudio() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [settings, setSettings] = useState<ShakeSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<GifResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<GifResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = useCallback(
    <K extends keyof ShakeSettings>(key: K, value: ShakeSettings[K]) =>
      setSettings((s) => ({ ...s, [key]: value })),
    [],
  );

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("That doesn't look like an image file.");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImage({ el, width: el.naturalWidth, height: el.naturalHeight, name: file.name });
    };
    el.onerror = () => {
      setError("Couldn't read that image.");
      URL.revokeObjectURL(url);
    };
    el.src = url;
  }, []);

  // Clear a stale result whenever the inputs change.
  useEffect(() => {
    if (resultRef.current) {
      URL.revokeObjectURL(resultRef.current.url);
      resultRef.current = null;
      setResult(null);
    }
  }, [image, settings]);

  // Paste-from-clipboard support.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) loadFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  // Live looping preview.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const previewSettings = { ...settings, size: PREVIEW_SIZE };
    const transforms = computeTransforms(previewSettings);
    const fit = fitContent(image.width, image.height, previewSettings);

    let raf = 0;
    let frame = 0;
    let last = 0;
    const interval = 1000 / settings.fps;

    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        drawFrame(ctx, image.el, fit, PREVIEW_SIZE, transforms[frame]);
        frame = (frame + 1) % transforms.length;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [image, settings]);

  const onGenerate = useCallback(async () => {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gif = await generateGif(image.el, image.width, image.height, settings);
      resultRef.current = gif;
      setResult(gif);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while rendering.");
    } finally {
      setBusy(false);
    }
  }, [image, busy, settings]);

  const downloadName = useMemo(() => {
    const base = image?.name.replace(/\.[^.]+$/, "") || "shake-it";
    return `${base}-${settings.style}.gif`;
  }, [image, settings.style]);

  const oversize = result ? result.bytes > SLACK_LIMIT : false;

  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Stage */}
      <section className="flex flex-col items-center justify-center gap-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-10">
        {!image ? (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) loadFile(file);
            }}
            className={`flex aspect-square w-full max-w-sm cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition ${
              dragging
                ? "border-violet-400 bg-violet-400/10"
                : "border-white/20 hover:border-white/40 hover:bg-white/[0.03]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadFile(file);
              }}
            />
            <div className="text-5xl">🫨</div>
            <div>
              <p className="font-medium">Drop an image here</p>
              <p className="text-sm text-white/50">
                or click to browse · or paste from clipboard
              </p>
            </div>
            <p className="text-xs text-white/40">PNG, JPG, GIF, WebP · transparent PNGs work best</p>
          </label>
        ) : (
          <>
            <div
              className="rounded-2xl p-3"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#2a2a35 25%,transparent 25%),linear-gradient(-45deg,#2a2a35 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a35 75%),linear-gradient(-45deg,transparent 75%,#2a2a35 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
              }}
            >
              <canvas
                ref={previewRef}
                width={PREVIEW_SIZE}
                height={PREVIEW_SIZE}
                className="h-[240px] w-[240px] rounded-lg"
              />
            </div>
            <div className="flex items-center gap-3 text-sm text-white/50">
              <span className="max-w-[200px] truncate">{image.name}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-white/15 px-3 py-1 text-white/80 transition hover:bg-white/10"
              >
                Replace
              </button>
            </div>
          </>
        )}
      </section>

      {/* Controls */}
      <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/50">
            Style
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {SHAKE_STYLES.map((s) => (
              <button
                key={s.value}
                title={s.hint}
                onClick={() => update("style", s.value as ShakeStyle)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  settings.style === s.value
                    ? "border-violet-400 bg-violet-500/20 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/25"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Intensity"
          value={settings.intensity}
          min={0.05}
          max={1}
          step={0.05}
          display={`${Math.round(settings.intensity * 100)}%`}
          onChange={(v) => update("intensity", v)}
        />
        <Slider
          label="Speed"
          value={settings.fps}
          min={6}
          max={30}
          step={1}
          display={`${settings.fps} fps`}
          onChange={(v) => update("fps", v)}
        />
        <Slider
          label="Smoothness"
          value={settings.frames}
          min={6}
          max={24}
          step={2}
          display={`${settings.frames} frames`}
          onChange={(v) => update("frames", v)}
        />

        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/50">
            Output size
          </h2>
          <div className="flex gap-2">
            {OUTPUT_SIZES.map((sz) => (
              <button
                key={sz}
                onClick={() => update("size", sz)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  settings.size === sz
                    ? "border-violet-400 bg-violet-500/20 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/70 hover:border-white/25"
                }`}
              >
                {sz}px
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-3">
          <button
            onClick={onGenerate}
            disabled={!image || busy}
            className="rounded-xl bg-violet-500 px-4 py-3 font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Shaking…" : "Generate GIF"}
          </button>

          {result && (
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">
                  {settings.size}×{settings.size} · {formatBytes(result.bytes)}
                </span>
                {oversize && (
                  <span className="text-amber-300" title="Slack emoji must be under 128 KB">
                    over 128 KB
                  </span>
                )}
              </div>
              {oversize && (
                <p className="text-xs text-amber-300/80">
                  Too big for a Slack emoji — try a smaller size, fewer frames, or lower intensity.
                </p>
              )}
              <a
                href={result.url}
                download={downloadName}
                className="rounded-lg bg-white px-4 py-2 text-center font-semibold text-black transition hover:bg-white/90"
              >
                Download GIF
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wider text-white/50">
          {label}
        </span>
        <span className="text-sm text-white/70">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  );
}
