export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-50">
      <div className="w-full max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-300">
          Kneeboard
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          INS waypoint-entry tracking for the home cockpit.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
          The local application foundation is ready. Tracker behavior will be
          added in the next implementation section.
        </p>
        <aside
          aria-label="Simulation-only warning"
          className="mt-10 border-l-4 border-amber-300 bg-amber-300/10 px-5 py-4"
        >
          <p className="font-semibold text-amber-200">
            For home flight simulation only.
          </p>
          <p className="mt-1 text-zinc-200">
            Kneeboard is not approved for real-world navigation or flight
            operations.
          </p>
        </aside>
      </div>
    </main>
  );
}
