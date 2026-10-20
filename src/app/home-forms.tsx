"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";

import { authClient } from "./auth-client";
import { loadLatestOfpAction, savePilotIdAction, type SavePilotIdState } from "./home-actions";
import { createLoadKeyState } from "./load-key";
import type { LoadUiResult } from "@/server/ofp-load-operations";

const initialSaveState: SavePilotIdState = { status: "idle", message: "" };

export function SignInForm() {
  const [status, setStatus] = useState<"idle" | "pending" | "sent" | "error">("idle");

  async function submit(formData: FormData) {
    const email = formData.get("email");
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus("error");
      return;
    }
    setStatus("pending");
    try {
      const result = await authClient.signIn.magicLink({ email: email.trim(), callbackURL: "/" });
      setStatus(result.error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form action={submit} className="mt-10 max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <h2 className="text-xl font-semibold">Sign in with a magic link</h2>
      <label htmlFor="sign-in-email" className="block text-sm font-medium text-zinc-200">Email address</label>
      <input id="sign-in-email" name="email" type="email" autoComplete="email" required
        className="w-full rounded-md border border-zinc-500 bg-zinc-950 px-3 py-2 text-zinc-50" />
      <button type="submit" disabled={status === "pending"}
        className="rounded-md bg-amber-300 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50">
        {status === "pending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {status === "sent" && <p role="status" className="text-sm text-zinc-200">If your address is eligible, check your inbox for a sign-in link.</p>}
      {status === "error" && <p role="alert" className="text-sm text-rose-300">We could not send a link. Check the address and try again.</p>}
    </form>
  );
}

export function PilotIdForm({ pilotId }: { pilotId: string | null }) {
  const [state, action, pending] = useActionState(savePilotIdAction, initialSaveState);
  return (
    <form action={action} className="mt-8 max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <h2 className="text-xl font-semibold">{pilotId === null ? "Set up your SimBrief Pilot ID" : "SimBrief Pilot ID"}</h2>
      <p className="text-sm text-zinc-300">Enter 1–16 digits. Saving does not contact SimBrief.</p>
      <label htmlFor="pilot-id" className="block text-sm font-medium text-zinc-200">Pilot ID</label>
      <input id="pilot-id" name="pilotId" type="text" inputMode="numeric" pattern="[0-9]{1,16}"
        minLength={1} maxLength={16} required defaultValue={pilotId ?? ""} autoComplete="off"
        className="w-full rounded-md border border-zinc-500 bg-zinc-950 px-3 py-2 text-zinc-50" />
      <button type="submit" disabled={pending}
        className="rounded-md bg-amber-300 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50">
        {pending ? "Saving…" : "Save Pilot ID"}
      </button>
      {state.status !== "idle" && <p role={state.status === "error" ? "alert" : "status"}
        className={state.status === "error" ? "text-sm text-rose-300" : "text-sm text-emerald-300"}>{state.message}</p>}
    </form>
  );
}

export function LoadOfpControl({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LoadUiResult | null>(null);
  const keys = useRef<ReturnType<typeof createLoadKeyState> | null>(null);
  const inFlight = useRef(false);
  keys.current ??= createLoadKeyState(() => crypto.randomUUID());

  function submit(retry: boolean) {
    if (pending || inFlight.current || !ready) return;
    const key = retry ? keys.current!.retry() : keys.current!.newAction();
    inFlight.current = true;
    setResult(null);
    startTransition(async () => {
      try {
        const next = await loadLatestOfpAction(key);
        setResult(next);
        if (next.status === "created" || next.status === "completed") {
          router.push(`/trackers/${encodeURIComponent(next.trackerId)}`);
        }
      } catch {
        setResult({ status: "failed", message: "The OFP could not be loaded. Check your plan and try again." });
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section className="mt-8 max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-6" aria-label="Load latest OFP">
      <h2 className="text-xl font-semibold">Load latest OFP</h2>
      {!ready && <p className="text-sm text-zinc-300">Save your SimBrief Pilot ID to enable loading.</p>}
      <button type="button" disabled={!ready || pending} onClick={() => submit(false)}
        className="rounded-md bg-amber-300 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50">
        {pending ? "Loading…" : "Load latest OFP"}
      </button>
      {result !== null && (
        <div role={result.status === "failed" || result.status === "signInRequired" || result.status === "invalidAction" ? "alert" : "status"}
          className="text-sm text-zinc-200">
          <p>{result.message}</p>
          {(result.status === "failed" || result.status === "inProgress" || result.status === "wait") && (
            <button type="button" disabled={pending} onClick={() => submit(true)}
              className="mt-3 rounded-md border border-zinc-500 px-3 py-2 font-medium disabled:opacity-50">Retry this load</button>
          )}
        </div>
      )}
    </section>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");

  async function signOut() {
    setStatus("pending");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setStatus("error");
        return;
      }
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-8">
      <button type="button" onClick={signOut} disabled={status === "pending"}
        className="rounded-md border border-zinc-500 px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50">
        {status === "pending" ? "Signing out…" : "Sign out"}
      </button>
      {status === "error" && <p role="alert" className="mt-2 text-sm text-rose-300">Sign-out failed. Try again.</p>}
    </div>
  );
}
