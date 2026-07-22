# SignalCollector

A production-quality, offline-first mobile app for manually recording traffic-signal
state transitions. Built for researchers riding as passengers or safely parked near
an intersection.

> **Safety:** Only a passenger or safely parked person should operate the collection
> controls. Do not interact with this application while driving. The app requires
> acknowledgment of this notice before the first collection session, and deliberately
> contains no speed recommendations, driving directions, or signal predictions.

## What it does

- Records every RED / YELLOW / GREEN (plus flashing/dark/unknown) button press with a
  millisecond device timestamp, GPS position, heading, speed, accuracy and altitude.
- Works fully offline: every press is written to local SQLite first, the UI never
  waits on the network, and a persistent sync queue uploads to Supabase with
  idempotent, exponentially-retried batches when connectivity exists.
- Reconstructs signal cycles (RED → GREEN → YELLOW → RED, including RED → GREEN
  directly and yellow-less turn arrows), flags anomalies, and reports median red /
  yellow / green / cycle durations — without ever silently altering raw observations.

## Tech stack

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo (SDK 51), TypeScript, Expo Router |
| Location | expo-location + expo-task-manager (opt-in background) |
| Maps | react-native-maps |
| Local storage | expo-sqlite (WAL) |
| App state | Zustand |
| Validation | Zod |
| Backend | Supabase Postgres + Auth (email magic links) + RLS |

## Project tree

```
signal-collector/
  app/
    _layout.tsx            # Root stack, DB init, auth deep links, auto-sync
    index.tsx              # Home: start, status, unsynced count, recent sessions
    intersections.tsx      # Map + search + add/drop-pin intersection selection
    movement.tsx           # Approach direction + movement type + description
    collect.tsx            # Big RED/YELLOW/GREEN buttons, undo, note, end
    sessions.tsx           # Session list with intersection/date filters
    session/[id].tsx       # Review: edit/delete observations, cycles, GPS path
    settings.tsx           # Debounce, accuracy threshold, background GPS, auth
  src/
    components/            # SignalButton, AccuracyBadge, SafetyNotice, pills
    database/              # db.ts (schema/migrations), repositories.ts
    hooks/                 # useSessionClock, useGpsStatus
    services/              # supabase.ts, syncEngine.ts (pure), syncService.ts,
                           # locationService.ts (fg + bg task)
    stores/                # sessionStore, syncStore, settingsStore, authStore
    types/                 # Domain models
    utils/                 # cycles.ts, debounce.ts, geo.ts, editing.ts, ids, time
    validation/            # Zod schemas
  supabase/
    migrations/0001_schema.sql
    migrations/0002_rls.sql
    seed.sql
  app.config.ts            # Permissions, plugins, deep-link scheme
  eas.json                 # EAS build profiles
  .env.example
```

## Setup

### Prerequisites (all platforms)

- Node.js 18+ (LTS recommended) and npm
- A phone (Android or iPhone) with the **Expo Go** app, or a development build (see below)
- A free [Supabase](https://supabase.com) account for sync (optional — the app runs
  fully offline without it)

### Windows setup

```powershell
# 1. Install Node LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)
# 2. Clone and install
git clone <this-repo>
cd Traffic-App\signal-collector
npm install

# 3. Configure environment
copy .env.example .env
# edit .env with your Supabase URL and anon key

# 4. Start the dev server
npx expo start
```

Windows notes:
- iPhone development **builds** cannot be compiled on Windows (Xcode is macOS-only);
  use **EAS Build** in the cloud instead (`eas build --platform ios --profile development`).
- Android testing works natively: enable USB debugging or use Expo Go over Wi-Fi.
- If the phone can't reach the dev server on a corporate/hotel network, run
  `npx expo start --tunnel`.

### Creating the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project** (any name, e.g.
   `signal-collector`). Save the database password.
2. In **Project Settings → API**, copy the **Project URL** and **anon public** key
   into `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
   Never copy the `service_role` key into the app — the client only ever uses the
   anon key, and Row Level Security enforces access.
3. Enable email magic links: **Authentication → Providers → Email** — ensure
   "Enable Email provider" is on (magic links are the default flow used by the app).
4. Add the app's deep link to **Authentication → URL Configuration → Redirect URLs**:
   `signalcollector://auth-callback` (and `exp://*` while testing in Expo Go).

### Applying SQL migrations

**Option A — SQL editor (fastest):** open **SQL Editor** in the Supabase dashboard and
run, in order:
1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/seed.sql`

**Option B — Supabase CLI:**

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # ref is in the dashboard URL
supabase db push                                  # applies supabase/migrations/*
psql "$(supabase status -o env | grep DB_URL)" -f supabase/seed.sql   # or paste seed.sql in the SQL editor
```

The commented block at the bottom of `seed.sql` creates a synthetic demo session
(three clean cycles) — sign in once, look up your user id in `auth.users`, and run it
with `YOUR_USER_ID` replaced.

## Testing on a physical phone

### Android (fastest path)

1. Install **Expo Go** from the Play Store.
2. `npx expo start` on your computer; scan the QR code with Expo Go (same Wi-Fi
   network, or use `--tunnel`).
3. Grant location permission when prompted; walk/drive (as a passenger!) to an
   intersection, start a session, and tap states.
4. Airplane-mode test: enable airplane mode, record observations, re-enable data —
   the unsynced count drains automatically when connectivity returns.

For a standalone dev build on a physical Android device:

```bash
npm install -g eas-cli
eas login
eas init                      # writes EAS_PROJECT_ID; put it in .env
eas build --platform android --profile development
# install the resulting .apk on the phone, then: npx expo start --dev-client
```

### iPhone (development build)

Expo Go works for the core flow, but background location requires a development build:

```bash
eas build --platform ios --profile development
```

- You need an Apple Developer account ($99/yr) for device builds; EAS handles
  signing. Register the device when prompted (`eas device:create`).
- Install the build via the QR code EAS produces, then run `npx expo start --dev-client`.
- On macOS you can instead run `npx expo run:ios` with Xcode installed.

## What requires a development build (not Expo Go)

| Feature | Expo Go | Dev build |
|---|---|---|
| Collection, SQLite, sync, maps, haptics, foreground GPS | ✅ | ✅ |
| **Background location** (expo-task-manager + `UIBackgroundModes`/foreground service) | ❌ iOS, ⚠️ unreliable Android | ✅ |
| Magic-link deep links via the `signalcollector://` scheme | ⚠️ uses `exp://` instead | ✅ |
| Custom Google Maps API key on Android release builds | n/a | ✅ |

Rule of thumb: everyday collection works in Expo Go; enable the **background
location** setting only in a development or production build.

## Platform limitations for background location

- **iOS**: requires the `location` background mode (already configured) and the user
  choosing "Allow While Using" then upgrading to "Always" in Settings. iOS shows a
  blue indicator/banner while background tracking runs. If the user force-quits the
  app, iOS stops delivering location updates — the app makes no claim of tracking
  after force-close.
- **Android 10+**: background location is a separate permission; on Android 11+ the
  system forces the user through Settings ("Allow all the time") — it cannot be
  granted from an in-app dialog. A persistent foreground-service notification is
  shown while tracking (required by the OS).
- **Both**: battery savers, Doze mode, and OEM task killers (Samsung/Xiaomi/etc.) can
  throttle or kill background updates; the app degrades gracefully — observations are
  only recorded by explicit user taps anyway, and foreground tracking resumes when
  the app reopens. Tracking is always stopped when the session ends.
- Google Play / App Store both require the prominent disclosure this app shows before
  enabling the feature; keep that language if you fork.

## Running the tests

```bash
npm test
```

Covers: transition legality, cycle reconstruction (incl. yellow-less arrow cycles),
exact-duplicate removal with reporting, timestamp ordering/stability, debounce with
raw-timestamp preservation, GPS accuracy warnings, stationary sample throttling,
offline queue retention, exponential retry/backoff, partial batch failure, and
observation-edit semantics.

## Architecture notes

- **Tap path**: press handler captures `Date.now()` **first** → haptic → debounce
  gate (evaluates, never regenerates the timestamp) → Zod validation → SQLite insert
  → UI update from SQLite → fire-and-forget `syncNow()`. Loss of cellular service
  never loses a record; the sync queue survives restarts.
- **Idempotency**: every entity carries a client-generated UUID. Sessions and
  intersections use it as their primary key; observations and location samples carry
  `client_generated_id` with a unique index, and uploads are `upsert ... on conflict`,
  so retries can never duplicate rows.
- **Raw data is sacred**: analysis sorts/flags/dedupes on copies and reports what it
  removed; state corrections snapshot the original state; deletes of already-synced
  observations enqueue an explicit remote delete.
- **Auth**: email magic links via Supabase. Signing in is only needed for sync —
  collection always works signed-out and offline.
- A future FastAPI analytics service can read the same Postgres schema; nothing in
  the app depends on it.
