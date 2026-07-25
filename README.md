# kneeboard

Kneeboard is a web-based waypoint-entry tracker for home flight simulation. It
loads the latest SimBrief LIDO Operational Flight Plan (OFP), converts eligible
route fixes into keypad-ready coordinates, and helps a pilot manage the repeating
1–9 memory slots of a CIVA or Litton inertial navigation system.

The MVP is designed around the CIVA/Delco Carousel IV-A and the three Litton
LTN-72 units modeled in the iniBuilds Lockheed L-1011 TriStar. It is not intended
for real-world navigation.

## Status

Planning is substantially complete. No application code exists yet. The
documents below are the project handoff and the source of truth for future
implementation planning.

## Documentation

- [Product decisions](docs/product-decisions.md) — audience, MVP experience,
  screens, data shown, failure behavior, and explicit non-goals.
- [Tracker behavior](docs/tracker-behavior.md) — waypoint eligibility,
  coordinate formatting, slot sequencing, state transitions, passing semantics,
  and page construction.
- [Technical decisions](docs/technical-decisions.md) — stack, integration,
  persistence, authentication, security, deployment, testing, and operations.
- [Planning status](docs/planning-status.md) — deferred work and the few
  implementation choices that remain open.

## MVP at a glance

1. A user signs in through an email magic link.
2. The user configures a numeric SimBrief Pilot ID.
3. An explicit **Load latest OFP** action fetches and validates a detailed LIDO
   navlog.
4. A new, persistent tracker is created for every successful load, even when the
   source OFP has not changed.
5. The tracker displays all primary-route navlog points while assigning eligible
   fixes to repeating INS memory slots 1–9.
6. The user records each fix as saved, then passed, or terminally skips a queued
   or pending fix.

## Selected stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS with dependency-light custom components
- Zod for runtime boundary validation
- Neon Postgres with Drizzle ORM and committed Drizzle Kit migrations
- Better Auth magic links delivered by Resend
- Vercel hosting at `kneeboard.v8ch.com`
- Vitest unit tests and a lean manual Playwright end-to-end suite
- `pnpm`, with Node.js LTS and tool versions pinned by mise

## Development tools

### Fetch a SimBrief OFP

After generating an OFP in SimBrief with the LIDO plan format and detailed
navlog enabled, fetch its JSON payload by passing the account's numeric Pilot ID:

```bash
uv run scripts/fetch_simbrief_ofp.py <pilot-id>
```

The script retrieves the account's latest generated OFP and saves the response
under `.local/simbrief/` with a UTC timestamped filename. This directory is
ignored by Git because raw OFPs can contain personal and account-related data.
Do not move an unreviewed payload into a tracked fixture directory. Sanitize any
payload selected for test coverage before committing it.

## Safety

Kneeboard is for home flight simulation only. It must not be represented as an
approved navigation tool or used for real-world flight operations.
