import ShakeStudio from "@/components/ShakeStudio";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          shake&nbsp;it <span className="inline-block">🫨</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-white/60">
          Make your favorite reaction come to life! May the chaos bring you
          unfettered joy.
        </p>
      </header>

      <ShakeStudio />
    </main>
  );
}
