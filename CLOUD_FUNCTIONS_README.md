# Refrigeration Tracker — Scheduled Daily Report (Cloud Functions)

This makes the 11:59 PM daily report **guaranteed** to fire every day, whether
or not anyone has the app open. The app itself already has a client-side
fallback that catches this if a browser tab is open around 11:59 PM — this
Cloud Function replaces the need to rely on that.

## What it does

Two scheduled functions, one per timezone:
- `dailyReportEastern` — fires at 11:59 PM **America/New_York**, covers PARF, KRF, GARF
- `dailyReportCentral` — fires at 11:59 PM **America/Chicago**, covers SRF

Each one checks whether a report for "today" already exists at that site
(manually submitted or already auto-generated) — if so, it does nothing. If
not, it builds the same snapshot the app builds (flagged units, not-checked
units with who they're assigned to, compliant count) and writes it in, tagged
`"System (Cloud Function, 11:59 PM)"` so it's clearly distinguishable from a
manual submission in the Daily Reports list.

## Before you deploy — Blaze plan required

Scheduled functions (Cloud Scheduler) need the **Blaze (pay-as-you-go)** plan —
the free Spark plan can't run them. If `refrigeration-tracker` is still on
Spark:

1. Go to the [Firebase console](https://console.firebase.google.com/project/refrigeration-tracker/usage/details)
2. Click **Upgrade** / **Modify plan**, choose **Blaze**
3. Attach a billing account (you'll need a payment method, but this workload
   is tiny — a few invocations a day, no heavy compute — realistically
   pennies a month, likely still within the free tier of the Blaze plan itself)

## Deploying

You'll need [Node.js](https://nodejs.org) installed on your own computer for this part — it can't be done through the browser or GitHub alone.

1. Install the Firebase CLI (one-time, if you don't have it already):
   ```
   npm install -g firebase-tools
   ```
2. Log in (opens a browser window for you to approve):
   ```
   firebase login
   ```
3. Unzip this package somewhere on your computer, then `cd` into that folder in a terminal.
4. Install the function's dependencies:
   ```
   cd functions
   npm install
   cd ..
   ```
5. Deploy just the functions:
   ```
   firebase deploy --only functions
   ```
6. Confirm in the [Firebase console → Functions](https://console.firebase.google.com/project/refrigeration-tracker/functions) that both `dailyReportEastern` and `dailyReportCentral` show up and are green/healthy.

## Testing it without waiting until 11:59 PM

In the Firebase console's Functions page, each scheduled function has a
"Test function" / manual trigger option (or you can trigger it via Cloud
Scheduler in Google Cloud Console, under the matching job name). Running it
manually once is a good way to confirm it writes a report correctly before
trusting it to run unattended overnight.

## If you ever add a 5th site in a different timezone

Add it to the `SITE_TIMEZONES` map in `functions/index.js` under the matching
timezone group (or a new one, with its own `onSchedule` export), then
redeploy with the same `firebase deploy --only functions` command.
