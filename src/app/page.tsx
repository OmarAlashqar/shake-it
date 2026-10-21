import ShakeStudio from "@/components/ShakeStudio";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          shake&nbsp;it <span className="inline-block">🫨</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-white/60">
          Turn any image into an intense, shaking animated GIF — perfect for
          Slack emoji. Upload, tweak, download. All in your browser.
        </p>
      </header>

      <ShakeStudio />

      <footer className="mt-12 text-center text-sm text-white/40">
        Nothing leaves your device — every frame is rendered locally.
      </footer>
    </main>
  );
}
