# Product decisions

## Purpose and audience

Kneeboard has one narrow MVP purpose: help a home flight-simulation pilot enter
SimBrief route waypoints into an inertial navigation system and track progress
through the INS memory slots.

The initial aircraft context is the iniBuilds Lockheed L-1011 TriStar with its
three modeled Litton LTN-72 units. The workflow must also be compatible with the
CIVA/Delco Carousel IV-A coordinate-entry model. The MVP intentionally does not
model differences between individual INS units.

This is a simulation aid only. No feature or copy should imply approval for
real-world navigation.

## Core user journey

### Sign in and setup

- Users authenticate with an email magic link.
- A SimBrief Pilot ID is configured in the application and stored privately for
  that account.
- Pilot ID is the only supported SimBrief identity. Username support is excluded
  to reduce ambiguity.
- A Pilot ID is a variable-length, digits-only identifier and is stored as a
  string. SimBrief does not document a fixed length or maximum.
- Saving the Pilot ID performs local syntactic validation only. It does not fetch
  an OFP or verify the ID with SimBrief.

### Home

The authenticated home screen:

- prominently requests Pilot ID setup when it is missing;
- provides an explicit **Load latest OFP** action once a Pilot ID is configured;
- never fetches an OFP automatically; and
- lists the account's 10 most recent successful OFP load instances.

Each recent item shows:

- tracker load date and time;
- flight number;
- origin and destination; and
- OFP generation time.

The displayed flight number is SimBrief's normalized `general.flight_number`
value as supplied. When SimBrief substitutes the simulator aircraft registration
because the user entered no airline or flight number, Kneeboard displays that
substituted value unchanged. The MVP does not normalize `aircraft.reg` solely to
detect or relabel this case.

Selecting a recent item opens that tracker. Older trackers remain stored but are
not listed or searchable in the MVP.

### Loading an OFP

- A load always fetches the latest OFP for the configured Pilot ID.
- Only SimBrief OFPs generated with the LIDO layout and a detailed navlog are
  accepted.
- A non-LIDO OFP is rejected with an explanation.
- An OFP generated without a detailed navlog is rejected with instructions to
  regenerate it with the navlog enabled.
- Every successful explicit load creates a new tracker instance, even if the same
  SimBrief OFP was loaded previously.
- A successful load opens its new tracker immediately.
- A failed fetch or validation creates no tracker, changes no existing tracker,
  and offers a retry.
- One user action is idempotent: transport retries or duplicate submissions for
  that action return the same tracker. A later deliberate click creates a new
  action and therefore a new tracker.

## Tracker screen

The tracker header shows:

- flight number;
- origin and destination;
- OFP generation time; and
- tracker load time.

All timestamps are stored and displayed only in UTC using an aviation-style
format such as `24 JUL 2026 1842Z`. Browser-local time is not shown.

The body presents waypoint pages described in
[Tracker behavior](tracker-behavior.md). The active page is visually distinct,
and the interface automatically navigates when the active page changes. Users
may still browse other pages manually.

Every tracker has a stable opaque URL. Direct access requires authentication and
server-side account ownership; knowing an ID never grants access.

## Interaction behavior

- Keypad-ready coordinates are read-only.
- LIDO coordinates, `DIS`, and `RDIS` are reference data and are read-only.
- Save, Pass, and Skip are server-confirmed actions. The relevant control is
  disabled while the request is in progress, and the display changes only after
  persistence succeeds.
- A failed action leaves the displayed state unchanged and offers a retry.
- Skipping is immediate, terminal, and has no confirmation dialog.
- Passing a single waypoint is immediate.
- When passing a waypoint will also pass earlier waypoints, a confirmation lists
  every affected waypoint before the cascade is committed.
- The MVP has no undo or visible activity history.

## Responsive design and accessibility

- The initial use case is desktop.
- Layout and component design are mobile-first because tablet and phone support
  is expected soon after launch.
- The MVP is a responsive website, not an installable Progressive Web App.
- Supported browsers are current Chrome, Edge, Firefox, and Safari, with
  responsive verification in mobile Safari and Chrome.
- The initial visual design is a single dark, high-contrast,
  cockpit-oriented theme.
- Core flows target WCAG 2.2 AA without making a formal conformance claim.
- Controls must be keyboard operable, have visible focus, use adequate touch
  targets, and never communicate status through color alone.

## Data ownership and retention

- Each authenticated account has private settings, raw OFPs, normalized
  navlogs, and tracker state.
- Account data synchronizes through the hosted database and survives refresh,
  browser restart, and switching devices.
- Reopened trackers remain editable.
- All successful tracker instances are retained indefinitely for MVP.
- Only the latest 10 appear on the home screen.
- Archive, delete, and account-data export workflows are deferred.

## Explicit MVP non-goals

- Real-world aviation use
- General preflight briefing, fuel, weather, or NOTAM presentation
- Free-form notes or annotations beyond tracker workflow state
- Printable output
- Per-INS-unit state for multi-unit aircraft
- Alternate or ETOPS diversion route tracking
- Realtime cross-device updates
- Offline use or offline mutations
- PWA installation
- Tracker reset
- Undo or skipped-waypoint restoration
- Visible event history
- Archive and delete controls
- Light theme

## References

- [Fetching a user's latest SimBrief OFP](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data)
- [SimBrief API options, including LIDO and detailed navlog](https://developers.navigraph.com/docs/simbrief/using-the-api)
- [Navigraph restrictions](https://developers.navigraph.com/docs/general/restrictions)
- [WCAG 2.2](https://www.w3.org/TR/wcag/)
