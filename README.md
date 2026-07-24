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

## Safety

Kneeboard is for home flight simulation only. It must not be represented as an
approved navigation tool or used for real-world flight operations.
