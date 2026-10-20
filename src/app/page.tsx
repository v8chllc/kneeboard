import { headers } from "next/headers";

import { getAccountSettings, resolveAccountId } from "@/server/account-settings";

import { LoadOfpControl, PilotIdForm, SignInForm, SignOutButton } from "./home-forms";

export default async function Home() {
  const requestHeaders = await headers();
  // Better Auth's session is cookie based. With no cookie, this is the visitor
  // state and no auth or settings connection is needed.
  const accountId = requestHeaders.has("cookie") ? await resolveAccountId(requestHeaders) : null;
  const pilotId = accountId === null ? null : await getAccountSettings().readPilotId(requestHeaders);
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-50">
      <div className="w-full max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-300">
          Kneeboard
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          INS waypoint-entry tracking for the home cockpit.
        </h1>
        {accountId === null ? (
          <>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              Sign in to configure your SimBrief Pilot ID for this account.
            </p>
            <SignInForm />
          </>
        ) : (
          <>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              {pilotId === null ? "Set up your Pilot ID to prepare for OFP loading." : "Your Pilot ID is saved for this account."}
            </p>
            <PilotIdForm pilotId={pilotId} />
            <LoadOfpControl ready={pilotId !== null} />
            <SignOutButton />
          </>
        )}
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
