import type { RecentLoadsResult } from "@/server/recent-load-contract";

import { formatUtcAviation } from "./tracker-view-model";
import { RecentLoadsRetry } from "./recent-loads-retry";

/** The list contains metadata only; tracker state is read on its own route. */
export function RecentLoads({ result }: { result: RecentLoadsResult }) {
  return <section className="mt-8 min-w-0 break-words rounded-xl border border-zinc-700 bg-zinc-900 p-6" aria-label="Recent OFP loads">
    <h2 className="text-xl font-semibold">Recent OFP loads</h2>
    {result.status === "unavailable" ? (
      <div className="mt-4 space-y-3">
        <p role="alert" className="text-sm text-rose-300">Recent loads could not be shown. Try again.</p>
        <RecentLoadsRetry />
      </div>
    ) : result.loads.length === 0 ? (
      <p className="mt-4 text-sm text-zinc-300">No OFPs loaded yet</p>
    ) : (
      <ol className="mt-4 space-y-3">
        {result.loads.map((load) => <li key={load.trackerId}>
          <a href={`/trackers/${encodeURIComponent(load.trackerId)}`}
            className="block rounded-lg border border-zinc-600 px-4 py-3 hover:border-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
            <span className="block font-semibold">{load.flightNumber} · {load.originIcaoCode} → {load.destinationIcaoCode}</span>
            <span className="mt-1 block text-sm text-zinc-300">Loaded {formatUtcAviation(load.loadedAtUtc)}</span>
            <span className="block text-sm text-zinc-300">OFP generated {formatUtcAviation(load.generatedAtUtc)}</span>
          </a>
        </li>)}
      </ol>
    )}
  </section>;
}
