# Set up Steady

Direct Zepp watch integration is available as an opt-in test alongside Health Connect. See [watch installation, pairing and validation](zepp-direct.md). Keep the existing health connection enabled until direct delivery is verified on the watch.

For convenient everyday use, use **Vercel for the website + Supabase for your private diary + the installed Android app on your Nothing Phone 3a**. You get one website address for the desktop, and the same diary in your phone app. Your computer can be off. You do not need to leave a terminal running.

The local server is an optional alternative. Choose one sync mode on each device at a time. Hosted mode is the easiest default; local mode works without internet when your devices can reach your computer.

## What syncs automatically

| Action | Behaviour |
| --- | --- |
| Add/edit a recipe, food, diary item, weigh-in or profile | Saves immediately on that device. Uploads about two seconds after the edit, while open and connected. |
| Another device is already open | Checks for changes approximately every 30 seconds. Returning to its window/app also triggers a check. |
| Log food offline | Saves locally. Uploads when connection returns while open, or when you next open the app. |
| Close the desktop tab or phone app | Food remains saved. Food/recipe edits wait until reopening; optional Android background checks can still import and upload activity. |
| Watch reconnects to phone | Zepp controls Bluetooth transfer and publishing into Health Connect. Steady cannot force this. |
| Open/return to the connected native Steady app | Reads seven days of health totals automatically; rechecks today and yesterday every 30 seconds while open. Diary sync shares the results. |
| Food reminder is due | Android shows the meal notification and plans the next check about 20 minutes later, even offline/with Steady closed. Battery-saving rules can delay delivery. |
| Tap Skip today | Android silences that meal for that date immediately without opening Steady. The skip joins your synced diary on next app use. Other meals and tomorrow remain active. |
| Log food on desktop | Cancels a corresponding phone reminder after the entry reaches the phone. A closed/offline phone may still remind you. |

**Example:** create “Chicken, rice and beans” on your desktop. Within a few seconds it is saved to Supabase. Open Steady on your phone; it downloads the recipe. Tap **Log a portion**, enter grams or servings, and save. That meal is later visible on the desktop automatically. Editing the recipe does not recalculate yesterday’s logged meal.

A saved recipe is a reusable template, not a record that you ate it. Log a portion to count its calories and dismiss that meal’s reminder. Reminders cannot tell whether an unlogged meal was skipped intentionally.

If two offline devices change the same record differently, sync stops and asks you to review the two versions through **Sync now**. Independent entries combine automatically. Export before resolving if you want to preserve both alternatives.

## 1. Create your Supabase diary

1. Create/sign in to an account at [Supabase](https://supabase.com/dashboard). Create a **Free** project. Choose an EU region if convenient for Malta; save the database password somewhere private.
2. Wait for the project to finish creating. Open **SQL Editor → New query**.
3. Paste the entire contents of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. It creates `diaries`, the owner-only access policy and the `save_diary` function. You can rerun this schema safely for this version.
4. Open **Authentication → Users → Add user / Create new user**. Create your personal email/password user. Use a strong password and choose **auto-confirm** for this admin-created personal account if the option appears. The app has a sign-in screen, not a public sign-up screen.
5. In **Authentication → Sign In / Providers** (dashboard wording can change), leave email/password sign-in enabled and disable **Allow new users to sign up**. Existing admin-created users can still sign in. Do not disable the email provider itself.
6. In **Connect** or **Project Settings → API Keys / Data API**, copy the **Project URL** and **publishable key** (`sb_publishable_…`; legacy `anon` key also works). These identify the project; privacy depends on authentication and the SQL access policy. Do **not** copy the secret or `service_role` key.

You will use these two values:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

These values are embedded in the browser/native build. The user password is entered in the app and is never placed in the source code or Vercel environment variables.

Official references: [Supabase auth users](https://supabase.com/docs/guides/auth/users), [auth configuration](https://supabase.com/docs/guides/auth/general-configuration), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 2. Deploy the website to Vercel

### With a GitHub repository

1. Put this project in your own GitHub repository. Keep `.env.local`, `.steady-data/`, certificates, pairing keys and build outputs out of Git. The included `.gitignore` covers them. A private repository is fine.
2. Sign in at [Vercel](https://vercel.com/new), choose **Add New → Project**, and import that repository.
3. Use framework preset **Vite**, build command **`npm run build`**, output directory **`dist`**, and **Node 24.x**.
4. Under **Environment Variables**, add the two `VITE_SUPABASE_…` values from above for Production. Add them to Preview only if you want preview builds to access the same diary; otherwise use a separate test project for previews.
5. Click **Deploy**. Open your `https://YOUR-PROJECT.vercel.app` address.
6. Go to **Settings & sync → Hosted sync** and sign in using the personal user you created in Supabase. Sync starts automatically.
7. Save that production URL as your desktop bookmark. Use the same URL when installing the website on other browsers. Different deployment URLs have separate local browser storage; signing in retrieves the shared diary.

`vercel.json` already contains the build/output settings and cache headers. The website is static; Supabase handles the data. No Vercel functions, cron job or paid notification service is required.

### Without GitHub

From this folder, run:

```sh
npx vercel
```

Follow the account/project prompts. In the resulting Vercel project, add the same two environment variables and Node version. Then run:

```sh
npx vercel --prod
```

A Vercel deploy does **not** deploy or initialize Supabase. Complete the SQL and account steps separately. After changing environment variables, redeploy: the old build still contains the old values.

### Free plan expectations

Vercel Hobby is for personal, non-commercial use. Supabase Free currently includes a 500 MB database; inactive free projects can be paused after a week. A personal text diary is small, but free tiers are not an uptime or permanent-pricing guarantee. If Supabase pauses, resume it in its dashboard; offline records remain on devices and sync later. This app has no paid features enabled automatically.

Check the current terms before setup: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Supabase pricing](https://supabase.com/pricing).

## 3. Install on your Nothing Phone 3a

You can first test food logging by visiting the Vercel URL in Chrome and choosing **Add to Home screen / Install app**. Load it online once so it can cache for offline use. **That browser installation does not include Health Connect access or scheduled food reminders.** Use the native Android build below for those.

### Build the native app once

1. Install Node.js **24+** and [Android Studio](https://developer.android.com/studio). Let its setup install the Android SDK and Platform Tools; this project also needs Android SDK Platform 36, which you can install from SDK Manager if the wizard only installed a newer platform. Use **JDK 21** for this project's Gradle JVM. If Android Studio reports that its bundled JVM 25 is incompatible with Gradle 8.14.3, click **Use JVM 21** and allow the download. Otherwise select/download JDK 21 under **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**.
2. In the project folder, create `.env.local` by copying `.env.example`. Enter the same public Supabase URL/key as Vercel. Never add the user password or a secret/service-role key. This file is ignored by Git.
3. Run:

   ```sh
   npm ci
   npm run native:sync
   npm run android
   ```

4. Android Studio opens the `android` project. Allow Gradle/package downloads and indexing to finish. If it asks for an SDK location, point it to the SDK installed by Android Studio.
5. On the phone, enable developer options (tap **Build number** repeatedly under **About phone / Software info**), enable **USB debugging**, connect a USB cable and approve your computer on the phone.
6. Select your Nothing Phone in Android Studio and click **Run ▶**. This installs a development build of Steady. You can unplug afterward; the app does not need your development server.
7. Alternatively, build a debug APK through Android Studio’s **Build APK(s)** action. The typical output is `android/app/build/outputs/apk/debug/app-debug.apk`. Transfer/install it on your own phone and allow that installer when Android prompts. Do not publish a debug APK.
8. In Steady, select **Settings & sync → Hosted sync**, sign in with the same personal user, and wait for the first successful sync. Set your profile/goals if desired. Nothing is entered into your public build by default.

If USB does not detect the phone, use Android Studio's device selector → **Pair Devices Using Wi-Fi**. Connect the phone and Mac to the same Wi-Fi network, enable **Developer options → Wireless debugging** on the phone, and follow the pairing-code or QR-code prompts. Once the phone appears as a connected device, select it and click **Run ▶** as above. This connection is only for installing/debugging; normal hosted diary sync still uses Supabase. See [Android's device connection guide](https://developer.android.com/studio/run/device).

For this personal install you do not need to publish on Google Play. If publishing later, Health Connect declarations, a privacy policy and release signing will be required. An APK update using the same application ID and signing key retains local data; uninstalling can remove it, so export first.

In **Settings & sync → Appearance → Colour theme**, choose **System (default)**, **Light** or **Dark**. System follows the device's appearance, including changes while Steady is open. An override is saved on that device and works offline. The website and phone can each follow their own system theme. Android's status/navigation icon contrast follows the selected app theme; the layout reserves the space reported by the device's system bars and screen cutouts.

The Android debug APK was successfully compiled in this workspace on 28 September 2026 with JDK 21 and Gradle 8.14.3, including the native health and meal-reminder plugins. It was installed and launched on the Nothing A059 over Wi-Fi; Android reported a successful launch, and the app process remained running with no startup errors in the checked AndroidRuntime/Capacitor console logs. Health imports and reminder delivery still need the device checks below. The iOS project has not been compiled here; full Xcode is required. See [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup).

### Future iPhone installation

The same project includes `ios/`. On a Mac with full Xcode installed, run `npm run native:sync`, then `npm run ios`. Choose your signing team, enable/verify HealthKit capability, check the included HealthKit usage description, and run on your own iPhone. Apple signing/distribution rules apply and should be checked for your account. The app reads Apple Health; Zepp must first share data there. iPhone compilation, signing and device behaviour are not yet verified. No App Store release is included.

## 4. Connect the watch when you have it

You do not need the watch to use food logging, recipes, weight, notifications or desktop sync.

1. Install **Zepp** from the official app store, sign in and pair the Amazfit watch. Grant the Bluetooth/nearby-device permissions required by Zepp.
2. Enter your physical profile correctly in Zepp so its activity estimates use your details. Keep Bluetooth on when you want data to transfer.
3. In Zepp, find **third-party account/data sharing → Health Connect** and enable writing steps, distance and active energy where available. Menu names and supported fields can vary by Zepp version. Confirm Zepp appears with write access in Android’s Health Connect settings.
4. In the installed Steady app, open **Activity → Connect health**. Grant **read** access for steps, distance and active calories. Steady requests no write access.
5. Once enabled, Steady checks seven days on opening/returning to the app, then today and yesterday every 30 seconds while open. **Check activity now** is only an optional troubleshooting button. The Activity page shows the last import and any problems. Turn automatic checks off there if you want.
6. Review Zepp’s **App Background Permissions Settings** and your Nothing phone’s per-app battery settings if Bluetooth transfer stops in the background. Do not force-stop Zepp. Allow its background activity as appropriate. Steady still cannot make Zepp export on a guaranteed schedule.

For a phone-free walk, start **Walking** on the watch and wait for its GPS fix before setting off. The watch can record without carrying the phone. Once back in Bluetooth range, Zepp is the bridge to the phone; any manufacturer account/internet requirements belong to Zepp. Detailed maps/routes remain in Zepp; Steady imports daily totals only. Verify the exact Bip Max model on the retailer’s listing before buying.

For activity updates while Steady is closed, enable **Activity → Enable background checks** in the updated Android app and grant the separate background health permission. See [Android background activity sync](#android-background-activity-sync). On iPhone, opening the app still triggers health imports and diary sync.

Official sources: [Amazfit Bip Max](https://uk.amazfit.com/products/bip-max), [Zepp background permissions](https://support.amazfit.com/en/amazfit_t-rex_3/docs/CrLzdsYAQonEmPxelbEcpCGbnQc), [Android background health reads](https://developer.android.com/health-and-fitness/health-connect/read-data).

## 5. Enable food reminders once

On the **installed phone app**, open **Settings → Meal reminders**:

1. Turn on **Remind me to log food**.
2. Keep **After each meal** for **10:00 breakfast, 14:00 lunch, 21:00 dinner**. You can edit these times or choose one daily check-in.
3. Select the overnight cutoff: **23:00** initially, or 22:00 / midnight. The next day always starts fresh; yesterday’s unanswered meals never carry forward.
4. Save and allow phone notification permission. Use **Test notification** to check delivery; it is scheduled about five seconds later, though Android may delay it.

After the first notification, Steady requests another every **20 minutes** until you respond or the cutoff is reached. Each meal is separate: ignoring breakfast does not cancel the lunch check. Android maintains one notification per meal instead of filling the notification shade with duplicates.

- **Log meal:** opens the relevant date and meal. Save the food or recipe portion you ate to stop further checks. Opening the form without saving does not acknowledge the meal.
- **Skip today:** silences only that meal for that date. On Android this action works directly in the notification without opening the app. For example, skip Friday breakfast; Saturday breakfast still gets its normal check.
- **Swipe away:** dismisses the displayed notification but does not acknowledge the meal, so the next check still arrives.
- **Diary:** each empty meal also has **Skip this meal today**, with **Undo** if you change your mind. Adding food to a skipped meal removes the skip.

A meal counts as logged once it has any food entry. Daily-check-in mode stops after any food entry or a skip for that day. A saved recipe alone is not a food entry; log a portion. Reminders prompt you to record what you ate, not to eat when you are not hungry or meet a calorie target.

**Android:** a native rolling alarm calculates each next check using local time. It is designed to work offline with the app closed, and is rescheduled after boot, timezone/clock changes and app updates. A skipped-meal action is saved by the phone immediately and merged into the shared diary on next app use. No Firebase, notification server or notification subscription is needed. Native Java compilation was verified on 28 September 2026; physical-device behaviour still needs verification.

**iPhone:** the OS permits a limited number of pending notifications. Steady schedules the next **60 checks**, coalescing meals due at the same moment. Actions refer to the first listed meal; use the diary for the others. iPhone Skip actions bring Steady forward to save the choice. The queue is replenished when you open/resume or log/skip; if you ignore all reminders without opening the app, it eventually runs out (around a day or two with these repeat times). This limitation does not apply to Android’s rolling scheduler. Reopen after timezone changes.

These are **local phone notifications**, not internet push. Android may delay the requested 20-minute interval, particularly in Doze, battery saver or after force-stop. This app does not request special exact-alarm access. Nothing phone delivery, restart restoration and notification actions still need testing on your device.

Desktop entries and skips only suppress phone reminders after they sync to that phone. Notification settings are per installation, so desktop sync does not enable duplicate reminders. See [Android alarm scheduling](https://developer.android.com/develop/background-work/services/alarms) and [Capacitor notification behaviour](https://capacitorjs.com/docs/apis/local-notifications).

## 6. Optional local sync

Local sync replaces Supabase as the shared diary. It does not relay your local server into Supabase automatically. Export a backup before switching storage modes, then connect both devices to the same chosen destination.

### On the desktop: no open terminal needed after starting

```sh
npm ci
npm run build
npm run local:start
```

Open **http://localhost:4173**. In **Settings & sync → Local sync**, enter `http://localhost:4173` and the pairing key printed by the command. The server runs in the background, so you can close the terminal. It requires the computer to remain awake.

```sh
npm run local:status
npm run local:stop
```

Start again after reboot. A foreground/debug alternative is `npm run local` (that terminal must stay open). The pairing key, diary snapshot and private server log live in `.steady-data/`. To view a lost key, open `.steady-data/pairing-key` privately. Do not commit/share that directory.

### Phone over USB (simplest local test)

A phone’s `localhost` means the phone itself. It does not normally mean your desktop. For a cable connection, use Android Platform Tools:

```sh
adb reverse tcp:4173 tcp:4173
```

Keep the cable attached and USB debugging authorized. In the native phone app, choose Local sync, enter **http://localhost:4173** and the same pairing key. USB forwarding carries that address to the computer. Repeat `adb reverse` if the connection/device restarts. The native network configuration allows only loopback plain HTTP; LAN uses HTTPS.

### Phone over home Wi-Fi (advanced, no cable)

Both devices must be on the same reachable home network, the computer awake, and the local server must use HTTPS trusted by the phone. The server intentionally refuses an unencrypted public/LAN listener.

One development option is [mkcert](https://github.com/FiloSottile/mkcert):

1. Install mkcert following its official instructions and run `mkcert -install` on your computer.
2. Find your computer’s home-network IP (for example `192.168.1.50`). Prefer reserving it in the router so it stays stable.
3. Create certificates in a private ignored folder:

   ```sh
   mkdir -p .steady-data/certs
   mkcert -cert-file .steady-data/certs/server.pem -key-file .steady-data/certs/server-key.pem localhost 127.0.0.1 192.168.1.50
   ```

   Replace the example IP with your actual IP.
4. Copy **only `rootCA.pem`** from the directory printed by `mkcert -CAROOT` to your phone and install it as a trusted CA certificate in Android’s credential/security settings. Never transfer `rootCA-key.pem` or the server private key. The native app is configured to trust user-installed CAs for this optional setup. Only use a CA you control.
5. Stop an already-running local instance. In a shell where Node trusts that CA, start:

   ```sh
   NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" \
   STEADY_HOST=0.0.0.0 \
   STEADY_TLS_CERT=.steady-data/certs/server.pem \
   STEADY_TLS_KEY=.steady-data/certs/server-key.pem \
   npm run local:start
   ```

6. On the phone enter **https://192.168.1.50:4173** and the pairing key. On desktop use **https://localhost:4173**. If asked, allow the connection in your local firewall. Do not forward this port on your internet router.
7. If using the Vercel website as a frontend to your local server, also set `STEADY_ALLOWED_ORIGINS=https://YOUR-PROJECT.vercel.app` before starting. Browser local-network permission may be required; native app + LAN HTTPS is the more predictable option.

The helper’s status/stop requests must also trust the CA:

```sh
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run local:status
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run local:stop
```

Do not bypass certificate validation. Hosted mode is much less setup if you want the easiest everyday experience. Plain `http://192.168…` is not a secure context for offline web installation and is not supported for pairing.

### Back up local hosting

Export from Settings regularly. To back up the server files, stop it and copy `.steady-data/` somewhere private. Restore that folder before restarting; retain the pairing key to keep devices connected. `STEADY_DATA_DIR` can point to a different private directory, but use the same value with start/status/stop.

## Android background activity sync

In the updated phone app, open **Activity → Enable background checks** and grant Health Connect's **Access data in the background** permission. Your Nothing Phone 3a supports the required Android version. Keep your usual hosted/local sync mode selected and signed in/paired; sync the diary once before leaving the app.

- Android WorkManager checks roughly every 15 minutes, reading the latest two days, with a seven-day catch-up on the first check each day. It uses the same local-day boundaries and aggregate measurements as foreground imports.
- Activity is retained privately on the phone. When internet or the local server is reachable, the worker uploads activity through the existing revision-checked diary endpoint. It preserves food, recipes, manual overrides and other remote changes. No Supabase SQL migration is needed.
- Background sync applies to **activity**, not unsent food/recipe edits. Open Steady on the device with those edits to sync them.
- Android controls actual timing. Battery saving, Doze, restricted app battery settings and force-stopping Steady can delay/prevent work. A force-stopped app must be reopened. Ordinary screen-off, switching apps and reboot are supported; a permanent foreground notification is not used.
- The worker cannot force Zepp to fetch the watch or publish to Health Connect. Grant Zepp its usual Bluetooth/background access too.
- Credentials and pending activity are encrypted using Android Keystore in app-private, non-backup storage. The native app and worker share refreshed sign-in tokens. Signing out removes the background server configuration; switching sync mode updates it. Clear device data/restore disables background checks.
- Turn it off with **Activity → Turn off background checks**, or revoke Health Connect's background permission. iPhone background health syncing is not implemented.

The desktop's **Phone health import** timestamp is the last phone import it has received. It is independent of the desktop diary-sync timestamp. No desktop wake-up/Firebase setup is required.

## Update the app

- **Website:** push changes to the linked branch or run `npx vercel --prod`. Existing users see an update banner. Click **Update app** after saving any open form.
- **Native phone:** increment Android's `versionCode` and `versionName` in `android/app/build.gradle`, run `npm run native:sync`, rebuild in Android Studio/Xcode and reinstall with the same identity/signing key. A paired Android phone can receive the build over Wi-Fi while Wireless debugging is enabled and both devices are on the same network; USB is optional. Vercel deployments do not replace the assets bundled inside an installed native app.
- **Local server:** `npm run local:stop`, `npm run build`, `npm run local:start`. Use the HTTPS environment variables again if applicable.
- After dependency changes, run `npm ci` (or the development install command), tests, build and native sync. Environment changes need a new website/native build.

## First-use acceptance checks

Before relying on the system, use a small test entry and verify:

- **Hosted sync:** sign in on two browsers/devices. Create a recipe on one; wait for successful sync, then return to the other. It should appear without pressing Sync. Log a portion offline, reconnect/open and verify the desktop total. Different edits on separate devices should combine.
- **Privacy:** signed out, the Supabase diary must be unreadable. If testing a second temporary auth user, it must see only its own diary, never the first user’s row. SQL policies are included but were not executed against a real Supabase project in this workspace.
- **Offline:** on an online first load wait for caching, close/reopen once, then enable airplane mode and log/edit a food. Reload and verify it remains. Reconnect/open and check sync.
- **Health:** after Zepp has a known walk, check that it appears in Health Connect, then open Steady. Compare steps/distance and identify whether energy is active or total in the source app. Reopen to check imports replace totals rather than adding them twice. Check the last import timestamp.
- **Background watch:** return from a walk and leave Zepp/Steady closed for a while. Inspect Health Connect and Zepp to establish what your watch/phone actually publishes automatically. With Android background checks enabled, compare the phone/desktop import timestamps after at least one scheduled check. Android may defer it; opening Steady still performs an immediate foreground check.
- **Notifications:** use Test notification, then set one reminder a few minutes ahead and close the app. Verify delivery offline. Wait for a repeat, then use Skip today and verify only that meal stops. Log another meal and verify its repeats stop. Swiping away should not stop repeats. Check the next-day reset, quiet cutoff and a phone restart too.
- **Backup:** export JSON, check it contains your entries, and retain it. Restore replaces local records after confirmation and disables sync until you reconnect.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| “Hosted setup needed” | Add both public Supabase variables and rebuild/redeploy. |
| Sign-in fails | Correct personal user/password, email provider enabled, user confirmed, project not paused. |
| Cloud sync fails | Run all of `schema.sql`, check project status and network. Never disable RLS to work around it. |
| Two different recipe edits | Use Sync now to review the conflicting record; export first if wanted. |
| No watch totals | First check Zepp → Health Connect. Then Steady read permission, native installation and last import. |
| Wrong step total | Check health-source priority so overlapping phone/watch data is resolved by the OS. Manual daily totals in Steady override imported totals; they are not added together. |
| No reminders in browser | Use the native app; PWA notifications are not implemented. |
| No native reminder | Check app notification permission, scheduled time, whether that meal is logged, battery restrictions, and whether you skipped the meal. On iPhone, reopen to replenish the queue. |
| Local server unreachable | Running/awake computer, correct port, USB reverse or trusted HTTPS, pairing key, firewall/CORS. |
| Existing data missing on a new URL | Browser storage is per origin. Sign in/pair to sync it, or restore a backup. |

Clearing a device does not erase cloud/server backups or Health Connect. To remove cloud records, delete the diary row or the auth user from your own Supabase dashboard. Sign-out leaves the offline diary; clear device data before sharing that installation.

### Step source

Android imports use only steps written by Zepp (`com.huami.watch.hmwatchmanager`), in both foreground and background checks. Health Connect performs the aggregation with a data-origin filter; Steady does not add raw phone and watch samples. This requires Android 14+ (background access still requires supported Android 15+). iPhone uses Apple Health’s aggregate. Active energy and distance continue to use the health store’s aggregated totals. The saved activity record identifies Zepp as the step source and syncs that label to desktop.

A recent “Health data checked” time means Steady read Health Connect. It does not mean Zepp has uploaded the latest watch records. Zepp controls that transfer; opening Zepp and letting it finish syncing can make newer data available. No desktop connection or USB cable is required for everyday sync.
