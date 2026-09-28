# Steady — your food, movement and progress

A personal food and fitness diary for desktop, Android and iPhone. Food logging, nutrition calculations, recipes and history work offline. Optional sync connects your devices through **Vercel + Supabase**, or a **local server on your computer**.

**Start here: [deployment and phone setup](docs/deployment.md).** It covers accounts, every setup command, Android installation, watch connection, reminders and troubleshooting.

## What is ready

- Log foods by grams; calculate calories, protein, carbohydrate, fat and fibre.
- An offline library of 24 USDA reference foods, with separate raw/cooked entries and source links. Add your own foods from package labels. Compact rows show 10, 20 or 50 foods at a time; search covers the whole library, including offline. Recipes, food logging and ingredient selection also have bounded result pages.
- Build recipes from ingredients, specify the finished dish weight and number of servings, then log grams or portions. Past diary entries retain their original nutrition when a recipe changes.
- Daily diary, calorie/macro totals, weight tracking and 7/30/90/365-day progress views.
- Native phone integration reads steps, active energy and walking/running distance from Health Connect / Apple Health. Connect once; checks run on opening, returning to the app and every 30 seconds while open.
- Optional **phone notifications** at 10:00, 14:00 and 21:00, repeating every 20 minutes until you log or skip that meal for the day. Android uses a rolling native alarm that works offline while closed. Times and the overnight cutoff are editable. An alternative daily check-in is available.
- Automatic hosted or local sync after edits, on reconnect, on returning to the app and every 30 seconds while open.
- Three-way sync combines independent changes and asks you to resolve conflicting edits. Export/restore JSON backups.

No ads, analytics, paid food database or subscription is built into the project. Calorie targets are optional and are not prescribed by the app. Watch activity calories are estimates and do not automatically increase your food allowance.

## How the devices fit together

```text
Desktop website ←→ your Supabase diary ←→ installed phone app
                                             ↑
                                  Health Connect / Apple Health
                                             ↑
                                         Zepp app
                                             ↑ Bluetooth
                                         Amazfit watch
```

Food, recipes, diary, profile, weight and imported activity all share the same diary. Sign in to the same personal account on both devices. **The phone needs the native app for health access and scheduled reminders.** Installing the website to your home screen gives offline food logging, but does not grant native health access.

You can log food and try the desktop dashboard before owning a watch. The watch stores activity while away from the phone; Zepp transfers it when reconnected. Steady cannot force Zepp to publish data or guarantee immediate background sync. This version imports health and synchronizes diaries while Steady is open, including when you return to it to log a meal. See the exact behaviour in [the sync guide](docs/deployment.md#what-syncs-automatically).

## Run on this computer

Install Node.js **24 or newer**, then:

```sh
npm ci
npm run build
npm run local:start
```

Open **http://localhost:4173**. The command prints a pairing key. In **Settings & sync → Local sync**, enter that address and key. You can close the terminal; the server keeps running until stopped or the computer restarts.

```sh
npm run local:status
npm run local:stop
```

This local server requires the computer to be awake. For a URL that works when your computer is off, follow the **Vercel + Supabase** setup. Start local again after reboot; hosted deployment needs no daily terminal command.

For development:

```sh
npm run dev
```

The development server is for editing the interface. Use a production build for offline/service-worker testing.

## Deploy and install

1. [Create a Supabase project and personal account](docs/deployment.md#1-create-your-supabase-diary).
2. [Deploy the website to Vercel](docs/deployment.md#2-deploy-the-website-to-vercel).
3. [Install the native Android app](docs/deployment.md#3-install-on-your-nothing-phone-3a).
4. [Connect Zepp and set up reminders](docs/deployment.md#4-connect-the-watch-when-you-have-it).

Hosted sync requires your own Supabase project, personal auth user and Vercel deployment; no account credentials are committed to this repository. The Android debug APK was successfully built in this workspace with JDK 21 on 28 September 2026. Physical-device health imports and reminders still need verification. The iOS project is prepared but has not been compiled or tested here.

## Data and privacy

IndexedDB saves the diary first. Hosted sync uses your Supabase project with authentication, row-level security and revision checks. The browser uses only a publishable key. **Never put a Supabase secret/service-role key in a `VITE_` variable.** The local server uses a private pairing key and saves an atomic snapshot under `.steady-data/`.

Skipped meals are saved by date and sync with your diary. Native health and notification permissions are optional. No cloud is needed for food logging or local reminders. Reminder preferences and health permissions belong to each installation; they do not transfer in diary backups. Regularly export a backup, especially before clearing browser/app data. Exported files contain your diary in plain JSON.

## Checks

```sh
npm test
npm run build
npm run test:e2e
npm run native:sync
```

Browser tests use installed Google Chrome and a temporary local server on port 4175. Unit tests cover calculations, raw/cooked yields, immutable log snapshots, dates/DST, backup validation, merge conflicts/deletions, storage transactions and conditional reminders. Browser tests cover offline reload, logging/editing, recipes, backups, mobile layout, automatic local sync, authentication and stale-write rejection. Real Supabase access policies and native device behaviour still need the deployment/device acceptance steps in the guide.

## Project map

| Location | Purpose |
| --- | --- |
| `src/` | Interface, food calculations, IndexedDB and sync |
| `src/foods.json` | USDA SR Legacy reference data |
| `src/health.ts` | Read-only native health integration |
| `src/reminders.ts`, `src/reminder-plan.ts` | Native notifications and conditional scheduling |
| `supabase/schema.sql` | Private cloud storage and revision-checked writes |
| `server/` | Optional local server and start/stop commands |
| `android/`, `ios/` | Capacitor native projects |
| `docs/deployment.md` | Deployment, installation, daily use and acceptance checks |

USDA FoodData Central data is public-domain/CC0. The seed library is extracted from SR Legacy, April 2018. To regenerate it, download the official SR Legacy JSON archive and run `python3 scripts/build-food-library.py /path/to/FoodData_Central_sr_legacy_food_json_2018-04.zip`. See [USDA datasets](https://fdc.nal.usda.gov/download-datasets/) and [data licensing](https://fdc.nal.usda.gov/api-guide/).
