# kneeboard

A web-based pre-flight planning companion that integrates with [SimBrief](https://www.simbrief.com/).

Named after the aviation *kneeboard* — the small board strapped to a pilot's leg holding notes, charts, and checklists during flight.

## Status

Early planning. No code yet. This README captures the scope and integration decisions made so far so the project can be picked up cleanly in a future session.

## Scope

- **Purpose:** Pre-flight planning companion. Import a SimBrief Operational Flight Plan (OFP), render a structured briefing view, allow annotations, and produce printable pre-flight material.
- **Not in scope (for now):** In-flight / live cockpit display, multi-user accounts, public hosting.
- **Audience:** Single user, running locally.

## Stack

- Next.js (App Router) + React + TypeScript
- SimBrief data fetched server-side (see below)

## SimBrief integration

**Decision: use the public fetcher endpoint, server-side. No OAuth.**

SimBrief's ecosystem exposes three integration surfaces, and only one is a fit for this project:

| Surface | What it is | Fit for kneeboard? |
| --- | --- | --- |
| `xml.fetcher.php` endpoint | Public URL that returns the user's most recent OFP as XML (or JSON with `&json=1`). Keyed by SimBrief `username` or `pilot_id`. No auth. | **Yes — this is what we'll use.** |
| SimBrief "Application API" | Form-embed + PHP-include model for Virtual Airline sites that need to *generate* plans on a pilot's behalf. Requires emailing `dev@navigraph.com` for an API key. Not OAuth, not REST. | No — designed for plan *generation*, not reading. |
| Navigraph OIDC API | Real OAuth 2.1 + PKCE at `identity.api.navigraph.com`. Vends charts and FMS data. Requires per-user Navigraph subscription. | No — does not return OFPs. Revisit only if chart integration is added later. |

### Fetcher endpoint usage

```
GET https://www.simbrief.com/api/xml.fetcher.php?username={username}&json=1
GET https://www.simbrief.com/api/xml.fetcher.php?userid={pilot_id}&json=1
```

Optional `&static_id={id}` pins a specific OFP; otherwise the endpoint always returns the pilot's *latest* plan (which changes silently when they regenerate on simbrief.com).

Docs: https://developers.navigraph.com/docs/simbrief/fetching-ofp-data

### Integration constraints

- **CORS:** The fetcher endpoint publishes no CORS headers. Client-side `fetch()` from the browser is blocked. Proxy through a Next.js server route handler.
- **Rate limits:** None published. Community norm is no more than one call every few seconds. Cache aggressively.
- **Schema:** No formal JSON Schema or OpenAPI spec. The XML tree is the schema-of-record. TypeScript types will be defined from a sample OFP.
- **JSON quirks:** JSON output mirrors the XML tree; some numeric fields come back as strings, and empty sections come back as empty strings rather than nulls. Validate defensively.

### OFP payload (high-level)

- General: origin, destination, airline, flight number, callsign, scheduled times, ETE
- Aircraft: type, registration, ICAO equipment, transponder, PBN, custom airframe weights
- Route: full ATC route string plus a decoded per-waypoint navlog (fix, lat/lon, altitude, track, wind, ISA dev, fuel remaining, time)
- Fuel: taxi, trip, contingency, alternate, final reserve, extra, tankering, block, min at destination
- Weights and balance: ZFW, TOW, LDW, payload, pax count, cargo
- Weather: METAR + TAF for origin, destination, alternates; enroute wind/temp
- NOTAMs (when requested at plan time)
- Alternates: up to 4 primary + takeoff/enroute/ETOPS, each with route and runway
- Files: PDF OFP URL, plain-text OFP, downloadable simulator flight plan files (PMDG, X-Plane, etc.)
- Text blocks: dispatcher remarks, custom remarks, ATC flight plan string

## Reference implementations

Open-source projects consuming the same endpoint, worth cribbing from:

- [FlyByWire A32NX](https://github.com/flybywiresim/aircraft) — best-in-class TypeScript parser (search the repo for `simbrief`).
- [PilotsDeck](https://github.com/Fragtality/PilotsDeck) — simple single-user fetch pattern in Lua.

## Next steps

1. Write a short scope doc: what does the briefing view actually show, and what can be annotated? This drives every remaining decision.
2. Scaffold Next.js + TypeScript + a styling choice (Tailwind is the low-friction default).
3. Implement `GET /api/simbrief/latest` as a route handler proxying the fetcher endpoint. Store `username` in local config.
4. First vertical slice: fetch one OFP, render a handful of key fields (route, fuel summary, weather).
5. Iterate on the briefing view from there.

## References

- Fetcher endpoint docs: https://developers.navigraph.com/docs/simbrief/fetching-ofp-data
- Application API (not used here): https://developers.navigraph.com/docs/simbrief/using-the-api
- Navigraph OIDC (not used here): https://developers.navigraph.com/docs/authentication/overview
- Restrictions / ToS: https://developers.navigraph.com/docs/general/restrictions
- Sample OFP XML: http://www.simbrief.com/api/demo.php
- Forum canonical thread: https://forum.navigraph.com/t/the-simbrief-api/5298
