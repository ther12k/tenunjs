# Polytron Wash — TenunJS companion app

Washing-machine companion for the **polytronwash v4** controller
(`Learning/polytronwash`, D1 R32 + TFT touch pod): live status, the six
functions (CUCI/PERAS/BUANG/ISI/BILAS/BILAS ND), programs, tuning and
water calibration — **over Bluetooth LE, no WiFi**. The washer's WiFi
only exists for a 30 s OTA window at boot; the app is the day-to-day
control channel, speaking the same GATT service the v4 firmware already
advertises. The firmware is untouched — this app is developed against
the deployed v4.10 protocol.

Same shape as the VOTOL example: `WasherRuntime` composes the screens,
every capability is a host-injected service seam (browser shell wires
Web Bluetooth; `test/polytron.test.ts` runs headless against a fake).

## Run it

```sh
bun examples/polytron/dev.ts        # http://localhost:8174
```

Web Bluetooth needs a **secure context**: `http://localhost` works on
the same machine. For a phone on the LAN, serve TLS first (the server
picks the cert up automatically):

```sh
cd examples/polytron
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout dev-key.pem -out dev-cert.pem -subj "/CN=polytron.local"
bun dev.ts                          # https://<lan-host>:8174
```

Then on the phone (Chrome/Edge, Android): open the URL, accept the
self-signed cert once, tap **Sambungkan**, power the washer, pick
**“Polytron Wash”**. iPhone has no Web Bluetooth — the v4 repo's
`v4/app/index.html` doc mentions nRF Connect as the fallback there.

## 100% Native TenunJS Android App (No WebView)

Polytron Wash is the official milestone validation app for native TenunJS execution on Android:

```sh
# 1. Bundle Polytron into Android embedder assets
bun run polytron:bundle

# 2. Build the native Android APK (:app:assembleDebug)
cd embedders/android
./gradlew :app:assembleDebug
```

- **Runtime:** Native embedded QuickJS engine running the TSX-compiled `polytron_app.js` bundle.
- **Rendering:** Native Android `SurfaceView` + Skia-backed hardware canvas rendering the full `DisplayOp` vocabulary (`rect`, `outline`, `text` with alignment, `circle`, `ring` progress arcs, `line`).
- **Hardware Integration:** JNI Host Service Bridge (`tenun_host_call`) injecting native Android Bluetooth Low Energy GATT directly into the JavaScript runtime, with live push updates into `WasherRuntime`.
- **Navigation:** Native in-scene bottom navigation bar (`Beranda`, `Program`, `Kontrol`, `Setelan`) with fixed bottom anchoring and touch hit regions.
- **Touch & Gestures:** Native Android `MotionEvent` hit-testing (`hitTestTaps`) and tap/long-press dispatching with touch-slop cancellation.

## Hybrid Android APK (WebView Prototype)

You can build and install a native Android `.apk` package that runs the companion app offline on your phone without needing the laptop server:

```sh
cd examples/polytron/android-apk
./build-apk.sh
```

- Output APK: `examples/polytron/polytron-wash.apk` (49 KB, signed with v1/v2/v3 schemes)
- Direct phone download over WiFi: open `http://<laptop-ip>:8174/apk` in your phone browser to download and install immediately.
- The app embeds a local loopback server (`127.0.0.1:8174`) so Chrome treats it as a **Secure Context**, unlocking full Web Bluetooth natively without requiring SSL certs or internet access.

## Screens

Mobile-first with a full-bleed phone view and a centered, wider desktop
preview; the browser host lays out at the real phone width (clamped to
320–430) so narrow screens render 1:1 instead of shrinking. The tabbed
app follows the washer's **LCD touch UI**: high-contrast status strip,
drawn outline function cards, and red STOP treatment. Programs stay on
their own tab. Every screen remains visible offline; unavailable actions
are disabled and settings/telemetry show unknown values until Bluetooth
data arrives.

| Tab | What |
|---|---|
| **Home** | Slim cycle strip, six-function icon grid (3×2 — every action visible, no paging), prominent red STOP, failure snack, humanized recent activity feed |
| **Programs** | Always-visible CEPAT/NORMAL/KUSTOM and TUB CLEAN cards with human-readable summaries; visual step builder modal (`+ Cuci`, `+ Bilas`, steppers, delete, raw token fallback); while running starts are inert and status strip taps jump to Home |
| **Controls** | Live mode, relay rows (indicators, not switches), battery-style AIR meter, STOP, WATER/VER probes; running status strip taps jump to Home; offline readings are explicitly unknown |
| **Settings** | MESIN (motor A/B, LCD clock) → DURASI steppers → SENSOR AIR calibration → LANJUTAN motor tuning; an unloaded value shows `belum dimuat` and steps nothing until `GET:ALL` delivers the real value |

## Interactive & UX enhancements

- **Visual Step Builder:** Program editing opens an intuitive step card list with steppers (`−` / `+`), quick-add buttons (`+ Cuci`, `+ Bilas`, `+ Buang`, `+ Isi`, `+ Peras`), live total duration calculation, and a collapsible raw-syntax view.
- **Active Touch Feedback & Haptics:** Tapping cards on canvas highlights the pressed target with a soft translucent glow; valid taps trigger tactile vibration (`navigator.vibrate(12)`).
- **Background Alerts & Dynamic Title:** Browser tab title dynamically reflects remaining time and mode (`(8:00) Cuci · Polytron Wash`), switches to `(✓ Selesai) Polytron Wash` upon cycle completion, and triggers a completion vibration pattern.
- **Direct Cycle Navigation:** Tapping the `StatusStrip` on Programs or Controls while a cycle is running jumps straight back to Home.
- **Auto-Reconnect & Fallback:** Web Bluetooth unexpected disconnect triggers up to 3 automatic reconnection attempts with backoff; tapping the header link pill on unsupported browsers (e.g. iOS Safari) opens an informative guidance alert.
- **Humanized Activity Log:** Recent Activity feed translates raw protocol tokens into clear Indonesian descriptions (`> WASH` → `Mulai Cuci`, `OK STOP` → `Mesin berhenti`).

## Reliability model

Commands flow through an **in-flight FIFO** in `runtime.ts`: the wire is
serial, so each reply settles the oldest outstanding command and routes
back to the screen that sent it (a query from another tab can no longer
steal a running command's reply). Outstanding commands are bounded by a
10 s **reply timeout** and settled with `ERR sambungan terputus` when the
link drops — no tile sticks on "MENGIRIM…". The browser's BLE writes go
through `src/write-queue.ts`, which **survives a failed write** (one radio
error must never block a later STOP). Connected-but-no-status-yet renders
as `MENUNGGU STATUS…`, never a fake SIAP/IDLE.

## Wire protocol (v4 firmware, unchanged)

Service `9f6d1c30-5f2e-4d8a-b7c3-00a1b2c3e001` · cmd write `…e002` ·
status read+notify `…e003`. Status lines:
`ST:MODE|prog|step|el|rem|ABDI|heapKB|Wpct` (1 s while connected),
`SET KEY value` ×14 after `GET:ALL`, and `OK …` / `BUSY - STOP first` /
`ERR …` replies on the same characteristic. Commands: `STOP`, `WASH`,
`SPIN`, `DRAIN`, `FILL` (optionally `:seconds`), `RINSE`, `RINSEND`,
`PROG 0..2`, `TUB`, `CLOCK hh:mm`, `SET KEY VAL`, `GET:ALL`, `WATER`,
`WCAL EMPTY|FULL|OFF`, `VER`. Pure parsing lives in `src/protocol.ts`.

## Layout

```text
src/
├── main.tsx                  entry: re-exports WasherRuntime (host-driven)
├── runtime.ts                screens + service seams + in-flight FIFO reply routing (TN-142 pushes)
├── theme.ts                  v4 LCD designer palette + mode colors
├── protocol.ts               ST:/SET/reply parsing, setting ranges — pure, tested
├── write-queue.ts            serial BLE write queue that survives failed writes
├── widgets.tsx               LCD-style function cards, STOP, rows (truncating, ≥40px targets)
└── screens/
    ├── home.screen.tsx       cycle strip + six-function grid + STOP + failure snack
    ├── programs.screen.tsx   program cards, MULAI/EDIT (inert while running), TUB CLEAN
    ├── control.screen.tsx    live device: relays, AIR, STOP, probes
    └── settings.screen.tsx   steppers (DURASI/LANJUTAN), motor A/B, clock, WCAL
preview.ts                    browser host: Web Bluetooth + responsive canvas shell + overlays
dev.ts                        dev server (TLS-capable for LAN phones)
test/polytron.test.ts         headless: parser + runtime/screens + write queue
```
