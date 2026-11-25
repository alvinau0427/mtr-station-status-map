# MTR Station Status Map

[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](#) &nbsp;
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](#) &nbsp;
[![Tailwind](https://img.shields.io/badge/Tailwind-%2338B2AC.svg?logo=tailwind-css&logoColor=white)](#) &nbsp;
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](#) &nbsp;
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)](#) &nbsp;
[![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](#) &nbsp;
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) &nbsp;

> An unofficial React + TypeScript web app that colours all **98 MTR stations** on the official system map, so you can see at a glance whether a station is running normally, delayed, disrupted, or out of service. **Station statuses are inferred from public DATA.GOV.HK / MTR APIs — they are not official station-level announcements.**

## Important Notices

> [!IMPORTANT]
> This is a **non-commercial demonstration project**. The MTR route map artwork (`public/routemap.svg`) is the property of MTR Corporation Limited. Obtain permission or replace the background with an independently drawn map before publishing.

> [!NOTE]
> Station colours are inferred from per-station next-train data (`isdelay`, `status`, `message`) plus the line-level RYG feed. They may differ from the official MTR service-status display. Light Rail is not covered by the Next Train API and therefore has no markers.

## Overview

- **Desktop** — full system map with 98 coloured station anchors, a journey panel, station search, and a status legend.
- **Mobile (<640px)** — the map rotates 90° and covers the screen; the journey panel, zoom buttons and footer are hidden. Use one-finger drag to pan, pinch to zoom, and double-tap to reset. The toolbar collapses into a single row with a `⋯` menu, and the legend becomes a floating button.

The tab icon follows the worst network status: **red** (disruption), **yellow** (delay), **orange** (data unavailable), **grey** (≥50% of stations non-service), otherwise **green**.

## Features

- **Station-level status inference** from the Next Train API and RYG line feed, with cautious wording for data absence.
- **98 measured anchors** in the SVG viewBox; interchange stations use capsule-shaped markers, ordinary stations use circles. Markers are opaque with a white outline.
- **Journey planner (desktop)**: Dijkstra over the line topology with an interchange penalty, affected-station list, and blue rings on route stations. No connecting polylines.
- **Station search / locate**: Chinese name, English name or station code; suggestions render in a portal dropdown with keyboard support.
- **Station detail popover**: per-line status, next three trains in a aligned table (destination / minutes / platform), official alert link.
- **Low-volume polling**: RYG-first adaptive plan; 0 station calls when all lines are green, 60 s cycle, 10 min full sweep, 3 min RYG cache.
- **429 circuit breaker**: any HTTP 429 pauses all station requests for 60 s (or longer if `Retry-After` requires it).
- **Resilience**: localStorage snapshot (trusted if <3 min), batch commits, stale-while-revalidate, failed refreshes keep last good data, ErrorBoundary fallback.
- **Dynamic favicon** built from the supplied train SVG, coloured from the app's status palette.
- **Production server** that serves `dist/` and proxies both APIs with short-lived caches and stale-on-error behaviour.
- **PWA basics**: manifest, favicon and theme colour.
- **42 unit tests** covering status inference, polling decisions, journey planning, API parsing and favicon rules.

### UI controls

- **Desktop**: drag to pan, scroll to zoom, `←/→/↑/↓` to pan, `+` / `-` to zoom, `Esc` or the target button to reset; `Update` refreshes data, `Full Scan` forces all 121 station requests.
- **Mobile**: one-finger pan, pinch zoom, double-tap reset, `⋯` menu for auto-refresh / full scan, floating legend toggle.
- **Journey panel**: type or search `From` / `To`, press Enter to pick a suggestion, then `Show Route and Affected Road Sections`.

## Tech Stack

React 18 · TypeScript 5 · Vite 6 · Tailwind CSS 3 · TanStack Query 5 · Zod 4 · Vitest 5 · Node.js 22 · Docker

## Data sources

| Source | Endpoint | Purpose |
| --- | --- | --- |
| Next Train API (DATA.GOV.HK / MTR) | `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php` | Per-station `isdelay`, `status`, `message` and upcoming trains |
| RYG line status feed | `https://tnews.mtr.com.hk/alert/ryg_line_status.xml` | Line-level green / yellow / red / grey and non-service hours |

Both endpoints are routed through `/api/schedule` and `/api/line-status` proxies. The Next Train API normally allows CORS, but its CDN can omit the header on throttled responses, so proxying keeps behaviour consistent. The proxy caches schedules for 10 s and the RYG feed for 60 s, and serves stale content on upstream failure.

### Polling strategy

| Setting | Value |
| --- | --- |
| Normal sync cycle | 60 s |
| RYG client cache | 180 s |
| Full sweep | every 10 min (121 pairs) |
| Concurrency / jitter | 5 workers, 300–800 ms |
| Fresh cache on reload | <3 min → shown immediately, no refresh |
| HTTP 429 | 1 retry honouring `Retry-After`, then 60 s circuit breaker |

## Status inference

| API condition | Marker |
| --- | --- |
| `status = 0` + suspended / closed | Red — disruption |
| `status = 0` + special-arrangement URL | Amber |
| `isdelay = Y` with train data | Yellow — delay |
| `isdelay = Y` without train data | Orange — data unavailable / unconfirmed |
| `isdelay = N` with train data | Green — normal |
| `isdelay = N` without trains | Grey — no trains at present |
| RYG `grey` | Grey — non-service hours |
| Stale observation | Grey — 「Data Expired」, last known status kept in the popover |

Interchange stations show one marker with the worst status among their lines.

## Usage

### Install & run

```bash
git clone https://github.com/alvinau0427/mtr-station-status-map.git
cd mtr-station-status-map
npm install
npm run dev      # http://localhost:5173 (development, HMR)
npm test         # 42 unit tests
npm run build    # production build in dist/
npm start        # http://localhost:8787 (built app + API proxy)
```

### Docker

```bash
docker build -t mtr-status .
docker run -p 8787:8787 mtr-status
```

`npm run dev` uses the Vite proxy; `npm start` uses `server/line-status-proxy.js`, which serves `dist/` and proxies `/api/*` in one process. For serverless hosting, split the two `/api` routes into functions and serve `dist/` statically.

## Project Structure

```
src/
├── assets/train.svg         # Train glyph for the favicon
├── components/              # Map, popover, toolbar, legend, journey panel, dropdown
├── data/                    # Lines, stations, measured anchors and shapes
├── domain/                  # Pure status inference, journey planner, polling rules
├── hooks/useStatusSync.ts   # Polling orchestration, cache, batching, breaker UI state
├── services/                # Next Train API client and RYG parser
├── utils/                   # Dynamic favicon generation
├── App.tsx
└── main.tsx
public/                      # routemap.svg, favicon.svg, manifest.webmanifest
server/line-status-proxy.js  # Static server + API proxy
```

## Limitations

- No Light Rail data (not covered by the Next Train API).
- No structured disruption reason, affected segment or recovery time — only free-text `message` and an optional official URL.
- No typhoon signal support (not present in the available feeds).
- Station status is inferred and may differ from the official line-level display.
- Mobile hides the journey planner to keep the map readable.

## License / Attribution

The source code is released under the [MIT License](LICENSE). Third-party materials (the MTR system map, train glyph and public API data) are **not** covered by the MIT License — see [NOTICE](NOTICE).

Unofficial demonstration project. Station and arrival data come from [DATA.GOV.HK](https://data.gov.hk/) and MTR public APIs. The MTR system map is copyright of MTR Corporation Limited — see the [official system map page](https://www.mtr.com.hk/en/customer/services/system_map.html) and [MTR announcements](https://www.mtr.com.hk/).
