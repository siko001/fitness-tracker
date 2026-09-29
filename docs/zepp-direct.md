# Direct Zepp watch steps

Steady's watch mini app sends `Step.getCurrent()` snapshots through Bluetooth to its Side Service inside Zepp, then to the existing Supabase project. It bypasses Zepp's Health Connect export. It still needs Zepp, Bluetooth and internet for delivery. It does not use a Zepp cloud-account API.

The registered Steady app ID is **1129260**. No app-store submission is required for a developer preview on Neil's Bip Max.

## Status and rollout

The initial release starts in **Testing** mode. The existing foreground and Android background Health Connect imports remain enabled. A direct reading must be received within the last hour before **I verified my watch · use direct steps** can activate it. Compare the watch and the direct reading, then test closed-app delivery and reconnection before activating.

When enabled, Overview, Activity and Progress use direct watch steps. A higher Zepp-only Health Connect total remains a fallback if the direct relay falls behind. Counters are cumulative and never added together. Manual totals retain priority. Calories and distance remain Health Connect measurements.

Direct readings live in separate owner-only tables and a per-account IndexedDB cache. They do not modify the diary JSON or its revision. Older clients keep working, and the native worker cannot overwrite direct readings. Existing diary exports currently contain Health Connect/manual activity, **not** this separate direct-reading history. The display cache contains recent readings; the backend retains accepted daily readings.

## Server

Run `supabase/zepp.sql` once in the project's SQL editor. The migration is additive and can be rerun. It creates:

- `zepp_connections`: one connection per account, defaulting to testing mode; only the SHA-256 token hash is stored.
- `zepp_step_days`: one latest snapshot per account and local watch date.
- Authenticated RPCs to pair/rotate, enable/disable and revoke.
- `ingest_zepp_steps`: a public RPC requiring a random 256-bit pairing credential. It can only upload validated step snapshots to its paired owner; it has no diary access or read capability. Neither service-role keys nor user login credentials are given to Zepp or the watch.

The server validates the step range, capture timestamp, local date and captured UTC offset. Uploads older than 32 days or over five minutes in the future are rejected. Duplicate/older snapshots succeed without replacing newer values. Revocation rejects further uploads; rotation creates a new device ID and returns to testing mode. Enabling requires a recent reading from that new pairing.

## Build and preview

```sh
cd zepp/steady
npm ci
npm run configure -- 1129260
npm run build
npm run login
npm run preview
```

Sign in with the Zepp account that owns that app ID. Preview creates an installation QR. The compiler is the official `@zeppos/zeus-cli` 1.9.3. `zeus.cjs` registers the compiler's bundled module alias because its local-install entry point otherwise looks in the project's package.json. The tool has legacy development dependencies; they are isolated from the Steady website and Android runtime.

The target is square-screen API level 3.0+, including the Bip Max. It intentionally uses Zepp's documented **390×450 compatibility drawing area**. The compiler emits a Bip Max 432×514 ZPS package as well. No unverified newer firmware API is required. Check the actual API level under Zepp Developer Mode → Device information before installing.

On the phone:

1. In Zepp, open **Profile → Settings → About** and tap the Zepp icon seven times to enable Developer Mode (labels can vary by app version).
2. Open the paired watch's Developer Mode and use its Scan control on the preview QR.
3. In Steady Android or web, open **Activity → Direct Zepp sync → Create watch pairing**. Copy the configuration; it is displayed once. Paste it in the Steady mini app's settings in Zepp. It authorizes step uploads, so keep it private. Disconnect and pair again to replace a lost configuration.
4. Open Steady on the watch and choose **Start sync**. Grant step and background-service permission. Only one continuous watch service can run; the watch may ask you to choose between this and another service.
5. Watch Steady's direct comparison panel. It shows **Watch captured** and **Server received** separately from **Health data checked**.

## Delivery and offline limits

Watch mini app 0.1.1 uses low-power Time and Step events, not global timers or 600 ms one-shot alarms. Changed step totals and day rollover are sent on the next minute event; when the count stays unchanged, it sends a check about every 15 minutes. It also sends immediately on start/reconnection. An unacknowledged delivery retries on minute events. Small packets use the official sample's device-side BLE routing envelope; Zepp's phone runtime handles that envelope before delivering the payload to the Side Service.

Steady checks for new direct snapshots every 10 seconds while visible and immediately on focus, foreground/resume and network recovery. Main totals and comparison readings update without a page refresh. The last-check time shows the app polling, while capture/receive times describe the watch snapshot. Zepp and Bluetooth availability can extend these intervals. The original watch mini app 0.1.0 keeps its 15-minute schedule until updated through a new preview QR.

The watch keeps the latest observed reading for up to 32 days. It checkpoints on minute events using temporary-file/rename persistence; service writes may fail while the screen is on and are retried when allowed. The phone Side Service also persists pending daily readings and retries on startup, incoming packets and minute timers while Zepp lets it run. The watch only discards a snapshot after the server acknowledged it. In-flight acknowledgements cannot erase newer readings.

A stored previous-day snapshot is only the last counter actually observed. It cannot reconstruct activity before installation, after service shutdown, or a final day total missed during reboot/permission loss. The last unpersisted minute can be lost during power failure. Bluetooth routing from App Service, automatic restart, physical-watch timing, battery usage and actual Zepp background lifetime require real-device validation.

## Verification

```sh
npm test
npm run test:zepp
npm run build
npm run test:e2e -- tests/browser/zepp.spec.ts
```

The PostgreSQL tests use PGlite and isolated fake accounts; they never write test steps into Neil's production diary. Coverage includes account isolation, column grants, token rotation/revocation, enable gating, duplicate and out-of-order delivery, timestamp/range limits and delayed local-day offsets. Watch simulations exercise minute delivery of changed steps, quiet 15-minute checks, retry, acknowledgement and rollover without global timers. The browser test checks 706 → 801 activation, a further 804-step server reading appearing automatically without navigation/reload, fallback, layout and unchanged stored diary.

Before calling the integration proven, record actual watch/Zepp/Steady counts and timestamps for:

- A foreground upload, then at least two scheduled uploads with the watch app and Steady closed.
- Bluetooth disconnection/reconnection and phone internet loss/recovery.
- A local midnight rollover and a watch/service restart.
- Battery impact and interaction with any other background watch service.

## Primary references

- [Official architecture and health-data sample](https://docs.zepp.com/docs/guides/architecture/arc/)
- [Background service availability and restrictions](https://docs.zepp.com/docs/guides/framework/device/app-service/)
- [Official messaging implementation](https://github.com/zepp-health/zeppos-samples/blob/main/application/1.0/todo-list/shared/message.js)
- [Step sensor](https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Step/)
- [Bip Max screen compatibility](https://docs.zepp.com/docs/guides/framework/device/screen-adaption/)
- [Developer Mode](https://docs.zepp.com/docs/guides/tools/zepp-app/) and [preview installation](https://docs.zepp.com/docs/guides/tools/cli/)
