# VOTOL companion app (TenunJS example)

A TenunJS app for the [esp-votol](https://github.com/ther12k/esp-votol)
electric-motorcycle project: live telemetry (LOCAL observe mode), controller
parameters (read-only), and the keyless-alarm panel — rendered entirely as
TenunJS display lists.

## Architecture

```
controller → ESP32 bridge → dashboard backend (webapp/app.py, :8080)
                                   │  /state.json + /api  (JSON)
                 dev.ts proxy ← same-origin /backend/*
                                   │
                preview.ts host ── VotolRuntime ── display-list scenes
```

- **Screens know no networking.** `VotolRuntime` exposes service seams
  (`navigate`, `command`, `keyless`); the browser host implements them with
  `fetch` through the same-origin proxy. The Android host will bind the same
  seams to a native module when one exists — the screens and runtime are
  already environment-agnostic and headless-tested.
- **Data is normalized defensively** (`src/snapshot.ts`): a down backend, an
  offline bridge, or a missing keyless module all render honest "unknown"
  surfaces, never crashes.
- Safety posture matches the backend: telemetry is LOCAL observe only,
  parameters are read-only, and the keyless module's own ignition/bench
  interlocks stay authoritative — the app only relays commands and reports
  the module's verdict.

## Run it

Terminal 1 — the dashboard backend (with the emulator for bench data):

```bash
cd ~/Workspace/Learning/esp-votol
python3 tools/fake_votol.py &        # optional: fake controller on :6638
python3 webapp/app.py                # dashboard on :8080
```

Terminal 2 — this app:

```bash
cd ~/Workspace/Learning/tenunjs
bun install                          # first time (workspace links)
bun examples/votol/dev.ts            # app on :8123, proxy → :8080
```

Open <http://localhost:8123> — or from the phone on the same WiFi,
`http://<this-machine>:8123`. Retarget the backend with
`VOTOL_DASH=http://192.168.1.55:8080 bun examples/votol/dev.ts`.

## Tests

```bash
bun test examples/votol
```

Headless: drives `VotolRuntime` with real `/state.json` shapes and asserts
the committed display list's text content (live numbers, ARMED/siren, fault
banners, parameter grouping, degraded/offline surfaces).
