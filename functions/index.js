/**
 * Refrigeration Tracker — guaranteed daily report generation.
 *
 * Two scheduled functions, one per timezone group, each firing at 11:59 PM
 * local time for the sites in that group. This runs server-side on Firebase's
 * infrastructure, so it fires every day whether or not anyone has the app open —
 * unlike the client-side fallback already in index.html, which only catches it
 * if a browser tab happens to be open around that time.
 *
 * Both functions do the exact same thing, just for different site lists /
 * timezones:
 *   1. Read that site's units + existing dailyReports.
 *   2. If a report for "today" (in that site's local timezone) already exists —
 *      submitted manually, or already auto-generated — do nothing.
 *   3. Otherwise, build the same snapshot the app itself builds (flagged /
 *      not-checked-with-assignee / compliant counts) and write it, tagged as
 *      auto-generated so it's clearly distinguishable in the UI.
 *
 * DEPLOYMENT NOTE: scheduled functions require the Blaze (pay-as-you-go) plan —
 * the free Spark plan can't run Cloud Scheduler jobs. Cost for this workload is
 * negligible (a few invocations a day, no heavy compute), but the project does
 * need to be upgraded first if it isn't already.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();

const STALE_HOURS = 12;

// Map each site to its real-world local timezone (IANA name).
const SITE_TIMEZONES = {
  eastern: { tz: "America/New_York", sites: ["parf", "krf", "garf"] },
  central: { tz: "America/Chicago", sites: ["srf"] },
};

function localDateKeyInTz(date, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function isMarkedOffToday(u, todayKey, tz) {
  if (!u.markedOffAt) return false;
  return localDateKeyInTz(new Date(u.markedOffAt), tz) === todayKey;
}
function neverChecked(u) {
  return !u.lastCheckAt;
}
function isStale(u) {
  if (!u.lastCheckAt) return true;
  return Date.now() - new Date(u.lastCheckAt).getTime() > STALE_HOURS * 3600 * 1000;
}
function statusOf(u) {
  if (u.currentTemp == null || u.fansOperating == null) return "unset";
  if (u.fansOperating === false) return "flag";
  if (u.compressorOperating === false) return "flag";
  if (u.currentTemp < u.tmin || u.currentTemp > u.tmax) return "flag";
  return "ok";
}
function complianceReasons(u) {
  const reasons = [];
  if (u.fansOperating === false) reasons.push("fans down");
  if (u.compressorOperating === false) reasons.push("compressor down");
  if (u.currentTemp != null && (u.currentTemp < u.tmin || u.currentTemp > u.tmax)) {
    reasons.push(`${u.currentTemp}°F (target ${u.tmin}-${u.tmax}°F)`);
  }
  return reasons;
}
function uid() {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function generateReportForSite(siteKey, tz) {
  const unitsSnap = await db.ref(`refrigeration/sites/${siteKey}/units`).get();
  if (!unitsSnap.exists()) return; // no units at this site, nothing to report
  const unitsObj = unitsSnap.val();
  const units = Object.keys(unitsObj).map((id) => ({ id, ...unitsObj[id] }));

  const todayKey = localDateKeyInTz(new Date(), tz);

  const reportsRef = db.ref(`refrigeration/sites/${siteKey}/dailyReports`);
  const reportsSnap = await reportsRef.get();
  const existing = reportsSnap.exists() ? Object.values(reportsSnap.val()) : [];
  const alreadyExists = existing.some((r) => r.date === todayKey);
  if (alreadyExists) {
    console.log(`[${siteKey}] Report for ${todayKey} already exists — skipping.`);
    return;
  }

  const flagged = units
    .filter((u) => statusOf(u) === "flag")
    .map((u) => ({
      name: u.name,
      location: u.location || "",
      reasons: complianceReasons(u).join(", ") || "flagged",
    }));

  const notChecked = units
    .filter((u) => (neverChecked(u) || isStale(u)) && !isMarkedOffToday(u, todayKey, tz))
    .map((u) => ({
      name: u.name,
      location: u.location || "",
      assignedTo:
        u.assignedUserNames && u.assignedUserNames.length
          ? u.assignedUserNames.join(", ")
          : "Unassigned",
    }));

  const compliant = units.length - flagged.length - notChecked.length;

  const report = {
    id: uid(),
    date: todayKey,
    submittedBy: "System (Cloud Function, 11:59 PM)",
    submittedAt: new Date().toISOString(),
    auto: true,
    totalUnits: units.length,
    compliantCount: compliant,
    flaggedCount: flagged.length,
    notCheckedCount: notChecked.length,
    flaggedUnits: flagged,
    notCheckedUnits: notChecked,
  };

  await reportsRef.child(report.id).set(report);
  console.log(`[${siteKey}] Auto-generated report for ${todayKey}: ${flagged.length} flagged, ${notChecked.length} not checked, ${compliant} compliant.`);
}

async function runGroup(group) {
  for (const siteKey of group.sites) {
    try {
      await generateReportForSite(siteKey, group.tz);
    } catch (err) {
      console.error(`Failed generating report for ${siteKey}:`, err);
    }
  }
}

// Fires at 23:59 America/New_York — covers PARF, KRF, GARF.
exports.dailyReportEastern = onSchedule(
  { schedule: "59 23 * * *", timeZone: SITE_TIMEZONES.eastern.tz },
  async () => {
    await runGroup(SITE_TIMEZONES.eastern);
  }
);

// Fires at 23:59 America/Chicago — covers SRF.
exports.dailyReportCentral = onSchedule(
  { schedule: "59 23 * * *", timeZone: SITE_TIMEZONES.central.tz },
  async () => {
    await runGroup(SITE_TIMEZONES.central);
  }
);
