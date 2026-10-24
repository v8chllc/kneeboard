"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { previewPass, type TrackerCommand, type TrackerSnapshot } from "../domain";
import type { TrackerReadResult } from "@/server/tracker-transport";

import { mutateTrackerAction } from "./tracker-actions";
import { buildTrackerView, formatUtcAviation, type TrackerRowView } from "./tracker-view-model";

type FoundTracker = Extract<TrackerReadResult, { status: "found" }>;

const stateDisplay = {
  queued: { glyph: "○", label: "Queued" },
  pending: { glyph: "▶", label: "Pending" },
  saved: { glyph: "✓", label: "Saved" },
  passed: { glyph: "↗", label: "Passed" },
  skipped: { glyph: "×", label: "Skipped" },
  ineligible: { glyph: "·", label: "Not slot-eligible" },
} as const;

function TrackerRow({ row, busy, onSave, onPass, onSkip }: {
  row: TrackerRowView;
  busy: boolean;
  onSave: (routeIndex: number) => void;
  onPass: (routeIndex: number, invoker: HTMLButtonElement) => void;
  onSkip: (routeIndex: number) => void;
}) {
  const { glyph, label } = stateDisplay[row.state];
  const entryReady = row.state !== "skipped" && row.state !== "ineligible";
  return (
    <li className="tracker-row" data-state={row.state} data-window={row.insideWindowRail || undefined}
      data-rail-start={row.railStart || undefined} data-rail-end={row.railEnd || undefined}>
      {row.pageStart !== null && <div className="tracker-page-rule">Page {row.pageStart}</div>}
      <div className="tracker-row-main">
        <span className="tracker-state" aria-label={label}><span aria-hidden="true">{glyph}</span> {label}</span>
        <strong className="tracker-ident">{row.point.ident}</strong>
        {row.slot !== null && <span className={`tracker-slot ${row.badge === "outline" ? "tracker-slot-outline" : ""}`}
          aria-label={`INS slot ${row.slot}`}>{row.slot}</span>}
      </div>
      <div className="tracker-row-detail">
        <span className="tracker-coordinates">
          {entryReady && <span className="tracker-keypad">{row.position.latitude.keypad} · {row.position.longitude.keypad}</span>}
          <span className="tracker-lido">{row.position.latitude.lido} · {row.position.longitude.lido}</span>
        </span>
        <span className="tracker-distance">DIS {row.point.dis ?? "—"} · RDIS {row.point.rdis} NM</span>
      </div>
      {(row.canSave || row.canPass || row.canSkip) && <div className="tracker-row-actions">
        {row.canSave && <button type="button" disabled={busy} onClick={() => onSave(row.routeIndex)}>Save</button>}
        {row.canPass && <button type="button" disabled={busy} onClick={(event) => onPass(row.routeIndex, event.currentTarget)}>Pass</button>}
        {row.canSkip && <button type="button" disabled={busy} onClick={() => onSkip(row.routeIndex)}>Skip</button>}
      </div>}
      {row.railStart && <span className="tracker-rail-cap tracker-rail-cap-start" aria-hidden="true" />}
      {row.railEnd && <span className="tracker-rail-cap tracker-rail-cap-end" aria-hidden="true" />}
    </li>
  );
}

function CascadeDialog({ affected, onCancel, onConfirm, busy }: {
  affected: readonly { routeIndex: number; ident: string }[];
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancelButton.current?.focus();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onCancel(); }} className="tracker-dialog" aria-labelledby="cascade-title" aria-describedby="cascade-description">
    <h2 id="cascade-title">Pass these waypoints?</h2>
    <p id="cascade-description">Passing the selected fix will also pass every earlier saved fix listed here.</p>
    <ol>{affected.map((fix) => <li key={fix.routeIndex}>{fix.ident} · route position {fix.routeIndex}</li>)}</ol>
    <div className="tracker-dialog-actions">
      <button ref={cancelButton} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" disabled={busy} onClick={onConfirm}>Pass listed waypoints</button>
    </div>
  </dialog>;
}

/** Display only confirmed snapshots; the domain owns all derived tracker rules. */
export function TrackerClient({ trackerId, initial }: { trackerId: string; initial: FoundTracker }) {
  const [snapshot, setSnapshot] = useState<TrackerSnapshot>(initial.snapshot);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<{ message: string; stale: boolean; kind: "success" | "error" } | null>(null);
  const [cascade, setCascade] = useState<{ routeIndex: number; expectedVersion: number; affected: readonly { routeIndex: number; ident: string }[] } | null>(null);
  const cascadeInvoker = useRef<HTMLButtonElement | null>(null);
  const view = buildTrackerView(initial.navlog, snapshot);
  const controlsBusy = busy || notice?.stale === true;

  async function send(command: TrackerCommand) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await mutateTrackerAction(trackerId, command);
      if (result.status === "applied") {
        setSnapshot(result.snapshot);
        setNotice({ message: command.type === "saveWaypoint" ? "Waypoint saved." : command.type === "passWaypoint" ? "Waypoint passed." : command.type === "skipWaypoint" ? "Waypoint skipped." : "Procedure inclusion updated.", stale: false, kind: "success" });
      } else {
        setNotice({ message: result.message, stale: result.status === "stale", kind: "error" });
      }
    } catch {
      setNotice({ message: "Tracker could not be updated. Try again.", stale: false, kind: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function pass(routeIndex: number, invoker: HTMLButtonElement) {
    const preview = previewPass(snapshot, routeIndex);
    if (preview.outcome === "rejected") {
      setNotice({ message: "This waypoint cannot be passed. Reload and try again.", stale: false, kind: "error" });
      return;
    }
    if (preview.routeIndexes.length > 1) {
      cascadeInvoker.current = invoker;
      setCascade({ routeIndex, expectedVersion: snapshot.version,
        affected: preview.routeIndexes.map((index) => ({ routeIndex: index, ident: initial.navlog.points[index].ident })) });
      return;
    }
    void send({ type: "passWaypoint", routeIndex, expectedVersion: snapshot.version });
  }

  function changeInclusion(kind: "sid" | "star") {
    void send({ type: "setProcedureInclusion", expectedVersion: snapshot.version,
      inclusion: { ...snapshot.procedureInclusion, [kind]: !snapshot.procedureInclusion[kind] } });
  }

  return <main className="tracker-shell">
    <header className="tracker-header">
      <Link href="/" className="tracker-home-link">← Home</Link>
      <p className="tracker-eyebrow">Kneeboard · INS tracker</p>
      <h1>{initial.header.flightNumber}</h1>
      <p className="tracker-route">{initial.header.originIcaoCode} → {initial.header.destinationIcaoCode}</p>
      <dl className="tracker-times">
        <div><dt>OFP generated</dt><dd>{formatUtcAviation(initial.header.generatedAtUtc)}</dd></div>
        <div><dt>Tracker loaded</dt><dd>{formatUtcAviation(initial.header.loadedAtUtc)}</dd></div>
      </dl>
      <p className="tracker-warning">For home flight simulation only. Not approved for real-world navigation.</p>
    </header>

    <section className="tracker-controls" aria-label="Procedure inclusion">
      <h2>Procedure fixes</h2>
      <p>SID and STAR fixes are included until you change them before the first Save.</p>
      <div className="tracker-control-buttons">
        {(["sid", "star"] as const).map((kind) => <button key={kind} type="button"
          disabled={controlsBusy || view.procedureControlsLocked} aria-pressed={snapshot.procedureInclusion[kind]}
          onClick={() => changeInclusion(kind)}>
          {kind.toUpperCase()} {snapshot.procedureInclusion[kind] ? "included" : "excluded"}
        </button>)}
      </div>
      {view.procedureControlsLocked && <p>Procedure controls locked after the first Save.</p>}
    </section>

    {notice && <div className="tracker-notice" role={notice.kind === "success" ? "status" : "alert"}><p>{notice.message}</p>
      {notice.kind === "error" && !notice.stale && <p>Try the same action again.</p>}
      {notice.stale && <button type="button" onClick={() => window.location.reload()}>Reload tracker</button>}
    </div>}

    <section className="tracker-route-list" aria-label="Complete navlog">
      <h2>Route · {view.pageCount} {view.pageCount === 1 ? "page" : "pages"}</h2>
      <p className="tracker-pass-advice">Passing a later saved fix also passes every earlier saved fix. Review the affected fixes before confirming a bypass.</p>
      {view.windowVisible && <p className="tracker-window-key">Left rail shows fixes currently written in the INS, including the rows between them.</p>}
      <ol>{view.rows.map((row) => <TrackerRow key={row.routeIndex} row={row} busy={controlsBusy}
        onSave={(index) => { void send({ type: "saveWaypoint", routeIndex: index, expectedVersion: snapshot.version }); }}
        onPass={pass}
        onSkip={(index) => { void send({ type: "skipWaypoint", routeIndex: index, expectedVersion: snapshot.version }); }} />)}</ol>
    </section>

    {cascade && <CascadeDialog affected={cascade.affected} busy={busy} onCancel={() => {
      setCascade(null);
      requestAnimationFrame(() => { cascadeInvoker.current?.focus(); cascadeInvoker.current = null; });
    }}
      onConfirm={() => {
        const selected = cascade;
        cascadeInvoker.current = null;
        setCascade(null);
        void send({ type: "passWaypoint", routeIndex: selected.routeIndex, expectedVersion: selected.expectedVersion });
      }} />}
  </main>;
}
