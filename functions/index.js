/**
 * Refrigeration Tracker — guaranteed daily report generation.
 *
 * Two scheduled functions, one per timezone group, each firing at 11:59 PM
 * local time for the sites in that group. This runs server-side on Firebase's
 * infrastructure, so it fires every day whether or not anyone has the app open —
 * unlike the client-side fallback in index.html, which only catches it if a
 * browser tab happens to be open around that time.
 *
 * IMPORTANT (fixed): "checked" and "compliant" are determined by scanning each
 * unit's actual history log for entries dated on the target day — NOT by a
 * rolling 12-hour staleness window. A unit checked at 9 AM is already >12 hours
 * old by 11:59 PM, so the old staleness-based approach wrongly counted normal
 * morning checks as "not checked." This version looks at each unit's history
 * for that specific calendar day instead, matching the client-side fix.
 *
 * DEPLOYMENT NOTE: scheduled functions require the Blaze (pay-as-you-go) plan.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();

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

function isMarkedOffForDate(u, dateKey, tz) {
  if (!u.markedOffAt) return false;
  return localDateKeyInTz(new Date(u.markedOffAt), tz) === dateKey;
}
function uid() {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Builds the same "checked / flagged / compliant" breakdown as the client,
// but scoped to a specific calendar day using each unit's history — not the
// unit's live current-state fields (which only reflect the most recent check,
// whenever that was).
function buildSnapshotForDate(units, dateKey, tz) {
  const flagged = [];
  const notChecked = [];

  units.forEach((u) => {
    const checksThatDay = (u.history || []).filter((h) => {
      if (h.entryType && h.entryType !== "check") return false;
      return localDateKeyInTz(new Date(h.at), tz) === dateKey;
    });

    if (checksThatDay.length === 0) {
      if (!isMarkedOffForDate(u, dateKey, tz)) {
        notChecked.push({
          name: u.name,
          location: u.location || "",
          assignedTo:
            u.assignedUserNames && u.assignedUserNames.length
              ? u.assignedUserNames.join(", ")
              : "Unassigned",
        });
      }
      return;
    }

    // Use the last check of that day to judge compliance for that day.
    const last = checksThatDay.slice().sort((a, b) => new Date(a.at) - new Date(b.at)).slice(-1)[0];
    const bad = last.fans === false || last.compressor === false || last.temp < u.tmin || last.temp > u.tmax;
    if (bad) {
      const reasons = [];
      if (last.fans === false) reasons.push("fans down");
      if (last.compressor === false) reasons.push("compressor down");
      if (last.temp < u.tmin || last.temp > u.tmax) reasons.push(`${last.temp}°F (target ${u.tmin}-${u.tmax}°F)`);
      flagged.push({ name: u.name, location: u.location || "", reasons: reasons.join(", ") || "flagged" });
    }
  });

  const compliant = units.length - flagged.length - notChecked.length;
  return { flagged, notChecked, compliant };
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

  const snap = buildSnapshotForDate(units, todayKey, tz);

  const report = {
    id: uid(),
    date: todayKey,
    submittedBy: "System (Cloud Function, 11:59 PM)",
    submittedAt: new Date().toISOString(),
    auto: true,
    totalUnits: units.length,
    compliantCount: snap.compliant,
    flaggedCount: snap.flagged.length,
    notCheckedCount: snap.notChecked.length,
    flaggedUnits: snap.flagged,
    notCheckedUnits: snap.notChecked,
  };

  await reportsRef.child(report.id).set(report);
  console.log(`[${siteKey}] Auto-generated report for ${todayKey}: ${snap.flagged.length} flagged, ${snap.notChecked.length} not checked, ${snap.compliant} compliant.`);
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
