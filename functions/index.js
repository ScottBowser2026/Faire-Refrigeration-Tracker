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

// ============================================================================
// Failure SMS alerts — 30-minute batch
// ============================================================================
// The app queues an alert record when a check puts a unit out of compliance.
// This sweeps every site every 30 minutes and sends ONE text per manager
// covering everything queued in that window, rather than a message per unit —
// a crew member working through a round of failing units would otherwise
// trigger a burst of separate texts.
//
// Trade-off worth knowing: a failure can wait up to 30 minutes before anyone's
// phone buzzes. The app flags it on screen immediately either way.
//
// Delivery status is written back onto each record so the Alert Log shows what
// actually went out. A text that silently fails is worse than no alerting,
// because you'd assume someone was told.

const { onSchedule: onScheduleAlerts } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = defineSecret("TWILIO_FROM_NUMBER");

const ALL_SITES = ["parf", "srf", "krf", "garf", "test"];

// Twilio wants E.164 (+15555551212). Accept whatever people typed.
function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).trim().startsWith("+")) return String(raw).trim();
  return null;
}

async function sweepSite(siteKey, client, from) {
  const ref = db.ref(`refrigeration/sites/${siteKey}/alertLog`);
  const snap = await ref.get();
  if (!snap.exists()) return 0;

  const all = snap.val();
  const queued = Object.keys(all)
    .map((id) => ({ id, ...all[id] }))
    .filter((a) => a.smsStatus === "queued");
  if (queued.length === 0) return 0;

  // Everyone who should be texted across this batch, de-duplicated by number.
  const byPhone = new Map();
  queued.forEach((a) => {
    (a.smsTo || []).forEach((r) => {
      const to = toE164(r.phone);
      if (to && !byPhone.has(to)) byPhone.set(to, r.name);
    });
  });

  if (byPhone.size === 0) {
    await Promise.all(queued.map((a) => ref.child(a.id).update({ smsStatus: "no-phone-numbers" })));
    return 0;
  }

  const lines = queued.map((a) => `• ${a.booth || ""} ${a.unitName || ""} — ${a.reasons || "out of compliance"}`);
  const siteName = (queued[0] && queued[0].site) || siteKey;
  const body =
    `REFRIGERATION ALERT — ${String(siteName).toUpperCase()}\n` +
    `${queued.length} unit${queued.length === 1 ? "" : "s"} out of compliance:\n` +
    lines.join("\n");

  let sent = 0;
  const failures = [];
  for (const [to, name] of byPhone.entries()) {
    try {
      await client.messages.create({ body, from, to });
      sent++;
    } catch (err) {
      console.error(`SMS to ${name} (${to}) failed:`, err && err.message);
      failures.push(`${name}: ${(err && err.message) || "send failed"}`);
    }
  }

  const status = sent > 0 ? "sent" : "failed";
  const processedAt = new Date().toISOString();
  await Promise.all(
    queued.map((a) =>
      ref.child(a.id).update({
        smsStatus: status,
        smsSentCount: sent,
        smsBatchSize: queued.length,
        smsError: failures.length ? failures.join("; ") : null,
        smsProcessedAt: processedAt,
      })
    )
  );

  console.log(`[${siteKey}] Batch: ${queued.length} alert(s), ${sent}/${byPhone.size} recipients texted.`);
  return sent;
}

exports.sendQueuedAlertSms = onScheduleAlerts(
  {
    schedule: "every 30 minutes",
    timeZone: "America/New_York",
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER],
  },
  async () => {
    let client;
    try {
      client = require("twilio")(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
    } catch (err) {
      console.error("Twilio init failed:", err);
      return;
    }
    const from = TWILIO_FROM_NUMBER.value();
    for (const siteKey of ALL_SITES) {
      try {
        await sweepSite(siteKey, client, from);
      } catch (err) {
        console.error(`Sweep failed for ${siteKey}:`, err);
      }
    }
  }
);
