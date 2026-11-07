/**
 * Refrigeration Tracker — server-side PIN login.
 *
 * Before this, every PIN lived in plain text inside the user lists, and the
 * browser downloaded all of them to check a login locally. The database rules
 * only required an anonymous sign-in, which anyone can do, so anyone could read
 * every PIN (Superadmins included) or rewrite any data.
 *
 * Now:
 *  - PINs never sit in the user lists. Each one is stored only as an HMAC under
 *    refrigeration/pinIndex (keyed by a server-only secret, RT_PIN_PEPPER), so a
 *    database read can't be turned back into PINs — a plain hash of a 4-digit
 *    PIN could be, by trying all 10,000.
 *  - rtLogin checks the PIN here and stamps the caller's anonymous Firebase
 *    account with custom claims (rtRole, rtSite, rtUid, rtUntil). The database
 *    rules (database.rules.json) grant access from those claims, and re-check
 *    that the person still exists with that role on every read/write, so a
 *    removal or role change takes effect immediately.
 *  - Any plain-text `pin` still found in a user record (from before this
 *    change, or from an old browser tab) is moved into the index and deleted on
 *    every login, so the lists heal themselves.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const RT_PIN_PEPPER = defineSecret("RT_PIN_PEPPER");
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = defineSecret("TWILIO_FROM_NUMBER");

const ROOT = "refrigeration";
const SITES = ["parf", "srf", "krf", "garf", "test"];
const SESSION_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const FORGOT_COOLDOWN_MS = 5 * 60 * 1000;
const PIN_RE = /^\d{4,6}$/;

const db = () => admin.database();

function pinKey(pin) {
  return crypto.createHmac("sha256", RT_PIN_PEPPER.value()).update(String(pin)).digest("hex");
}

function recordPath(scope, site, userId) {
  if (scope === "superadmin") return `${ROOT}/superadmins/${userId}`;
  if (scope === "lancelot") return `${ROOT}/lancelotManagement/${userId}`;
  return `${ROOT}/sites/${site}/users/${userId}`;
}

function roleFor(scope, rec) {
  if (scope === "superadmin" || scope === "lancelot") return scope;
  return (rec && rec.role) || "crew";
}

function fullName(p) {
  const n = `${p.firstName || ""} ${p.lastName || ""}`.trim();
  return n || p.name || "(no name)";
}

// Twilio wants E.164 (+15555551212). Accept whatever people typed.
function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).trim().startsWith("+")) return String(raw).trim();
  return null;
}

function callerIp(req) {
  const raw = req.rawRequest;
  const fwd = raw && raw.headers && raw.headers["x-forwarded-for"];
  const ip = fwd ? String(fwd).split(",")[0].trim() : (raw && raw.ip) || "unknown";
  return ip.replace(/[.#$[\]/:]/g, "_");
}

// Every person in every list, as {scope, site, userId, rec}.
async function allPeople() {
  const [sa, lm, sites] = await Promise.all([
    db().ref(`${ROOT}/superadmins`).get(),
    db().ref(`${ROOT}/lancelotManagement`).get(),
    Promise.all(SITES.map((s) => db().ref(`${ROOT}/sites/${s}/users`).get())),
  ]);
  const out = [];
  Object.entries(sa.val() || {}).forEach(([id, rec]) => out.push({scope: "superadmin", site: null, userId: id, rec}));
  Object.entries(lm.val() || {}).forEach(([id, rec]) => out.push({scope: "lancelot", site: null, userId: id, rec}));
  sites.forEach((snap, i) => {
    Object.entries(snap.val() || {}).forEach(([id, rec]) => out.push({scope: "site", site: SITES[i], userId: id, rec}));
  });
  return out;
}

async function recordExists(entry) {
  if (!entry) return false;
  return (await db().ref(recordPath(entry.scope, entry.site, entry.userId)).get()).exists();
}

// Moves any plain-text `pin` field into the index and deletes it.
async function migratePlaintextPins() {
  const people = (await allPeople()).filter((p) => p.rec && p.rec.pin !== undefined && p.rec.pin !== null);
  if (people.length === 0) return 0;
  const [indexSnap, byUserSnap] = await Promise.all([
    db().ref(`${ROOT}/pinIndex`).get(),
    db().ref(`${ROOT}/pinByUser`).get(),
  ]);
  const index = indexSnap.val() || {};
  const byUser = byUserSnap.val() || {};
  const updates = {};
  for (const p of people) {
    const pin = String(p.rec.pin).trim();
    updates[`${recordPath(p.scope, p.site, p.userId)}/pin`] = null;
    if (!PIN_RE.test(pin)) {
      console.warn(`migrate: dropped unusable PIN for ${p.userId}; they'll need a reset`);
      continue;
    }
    const key = pinKey(pin);
    const holder = index[key];
    if (holder && holder.userId !== p.userId && await recordExists(holder)) {
      console.warn(`migrate: ${p.userId} shares a PIN with ${holder.userId}; dropped it, they'll need a reset`);
      continue;
    }
    const oldKey = byUser[p.userId];
    if (oldKey && oldKey !== key) updates[`${ROOT}/pinIndex/${oldKey}`] = null;
    const entry = {scope: p.scope, site: p.site, userId: p.userId};
    index[key] = entry;
    byUser[p.userId] = key;
    updates[`${ROOT}/pinIndex/${key}`] = entry;
    updates[`${ROOT}/pinByUser/${p.userId}`] = key;
  }
  await db().ref().update(updates);
  console.log(`migrate: moved ${people.length} plain-text PIN(s) out of the user lists`);
  return people.length;
}

// The caller's identity from their claims, re-checked against the database
// the same way the rules do it.
async function requireCaller(req) {
  const t = (req.auth && req.auth.token) || {};
  if (!t.rtUid || !t.rtRole || !(t.rtUntil > Date.now())) {
    throw new HttpsError("unauthenticated", "Please log in again.");
  }
  const scope = t.rtRole === "superadmin" || t.rtRole === "lancelot" ? t.rtRole : "site";
  const site = scope === "site" ? t.rtSite : null;
  const rec = (await db().ref(recordPath(scope, site, t.rtUid)).get()).val();
  if (!rec || roleFor(scope, rec) !== t.rtRole) {
    throw new HttpsError("unauthenticated", "Please log in again.");
  }
  return {scope, site, userId: t.rtUid, role: t.rtRole, rec};
}

function canManage(caller, scope, site, userId) {
  if (caller.role === "superadmin") return true;
  if (caller.userId === userId && caller.scope === scope && caller.site === site) return true;
  return caller.role === "admin" && scope === "site" && site === caller.site;
}

// Sets (or generates) a PIN for an existing person. Returns the PIN.
async function assignPin(scope, site, userId, wanted) {
  const target = {scope, site, userId};
  if (!await recordExists(target)) throw new HttpsError("not-found", "That person wasn't found — save them first.");
  const byUserRef = db().ref(`${ROOT}/pinByUser/${userId}`);
  const oldKey = (await byUserRef.get()).val();

  const isFree = async (key) => {
    const holder = (await db().ref(`${ROOT}/pinIndex/${key}`).get()).val();
    return !holder || holder.userId === userId || !await recordExists(holder);
  };

  let pin = wanted ? String(wanted).trim() : "";
  let key;
  if (pin) {
    if (!PIN_RE.test(pin)) throw new HttpsError("invalid-argument", "PIN must be 4-6 digits.");
    key = pinKey(pin);
    if (!await isFree(key)) throw new HttpsError("already-exists", "That PIN is already in use by someone else.");
  } else {
    for (let i = 0; i < 60 && !key; i++) {
      const candidate = String(i < 50 ? crypto.randomInt(1000, 10000) : crypto.randomInt(10000, 100000));
      const k = pinKey(candidate);
      if (await isFree(k)) {
        pin = candidate;
        key = k;
      }
    }
    if (!key) throw new HttpsError("resource-exhausted", "Couldn't find a free PIN — try again.");
  }

  const updates = {
    [`${ROOT}/pinIndex/${key}`]: target,
    [`${ROOT}/pinByUser/${userId}`]: key,
    [`${recordPath(scope, site, userId)}/pin`]: null,
  };
  if (oldKey && oldKey !== key) updates[`${ROOT}/pinIndex/${oldKey}`] = null;
  await db().ref().update(updates);
  return pin;
}

// ---------- Login ----------
exports.rtLogin = onCall({secrets: [RT_PIN_PEPPER]}, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Couldn't connect — reload and try again.");
  const pin = String((req.data || {}).pin || "").trim();

  const attemptRef = db().ref(`${ROOT}/loginAttempts/${callerIp(req)}`);
  const attempt = (await attemptRef.get()).val();
  const now = Date.now();
  if (attempt && now - attempt.windowStart < LOGIN_WINDOW_MS && attempt.count >= LOGIN_MAX_FAILS) {
    throw new HttpsError("resource-exhausted", "Too many wrong PINs. Try again in a few minutes.");
  }
  const fail = async () => {
    await attemptRef.transaction((cur) =>
      !cur || now - cur.windowStart > LOGIN_WINDOW_MS ?
        {count: 1, windowStart: now} :
        {count: (cur.count || 0) + 1, windowStart: cur.windowStart});
    throw new HttpsError("permission-denied", "Incorrect PIN.");
  };
  if (!PIN_RE.test(pin)) return fail();

  await migratePlaintextPins();
  const key = pinKey(pin);
  const entry = (await db().ref(`${ROOT}/pinIndex/${key}`).get()).val();
  if (!entry) return fail();
  const rec = (await db().ref(recordPath(entry.scope, entry.site, entry.userId)).get()).val();
  if (!rec) {
    // The person was deleted from a list; drop their stale index entry.
    await db().ref().update({[`${ROOT}/pinIndex/${key}`]: null, [`${ROOT}/pinByUser/${entry.userId}`]: null});
    return fail();
  }
  await attemptRef.remove();

  const role = roleFor(entry.scope, rec);
  const until = now + SESSION_MS;
  await admin.auth().setCustomUserClaims(req.auth.uid, {
    rtRole: role,
    rtSite: entry.site || "-",
    rtUid: entry.userId,
    rtUntil: until,
  });
  return {
    role,
    site: entry.site,
    userId: entry.userId,
    name: fullName(rec),
    hasPhone: !!rec.phone,
    until,
  };
});

// ---------- Logout ----------
exports.rtLogout = onCall(async (req) => {
  if (req.auth) await admin.auth().setCustomUserClaims(req.auth.uid, null);
  return {ok: true};
});

// ---------- Set someone's PIN (or generate one) ----------
// Superadmins: anyone. F&B Managers: their own site's users. Everyone: themselves.
exports.rtSetPin = onCall({secrets: [RT_PIN_PEPPER]}, async (req) => {
  const caller = await requireCaller(req);
  const {scope, userId, pin} = req.data || {};
  const site = scope === "site" ? (req.data || {}).site : null;
  if (!["superadmin", "lancelot", "site"].includes(scope) || !userId || !/^[A-Za-z0-9_-]{1,60}$/.test(userId)) {
    throw new HttpsError("invalid-argument", "Bad request.");
  }
  if (scope === "site" && !SITES.includes(site)) throw new HttpsError("invalid-argument", "Bad site.");
  if (!canManage(caller, scope, site, userId)) {
    throw new HttpsError("permission-denied", "You can't change that person's PIN.");
  }
  await migratePlaintextPins();
  return {pin: await assignPin(scope, site, userId, pin)};
});

// ---------- Forgot PIN ----------
// The new PIN goes by text to the phone on file — never back to the browser,
// since whoever is at the login screen may not be the account's owner.
exports.rtForgotPin = onCall(
  {secrets: [RT_PIN_PEPPER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER]},
  async (req) => {
    const generic = {message: "If that email is on file with a phone number, a new PIN has been texted to it."};
    if (!req.auth) return generic;
    const email = String((req.data || {}).email || "").trim().toLowerCase();
    if (!email) return generic;

    await migratePlaintextPins();
    const match = (await allPeople()).find((p) => p.rec && String(p.rec.email || "").trim().toLowerCase() === email);
    if (!match) {
      console.log("forgotPin: no account for that email");
      return generic;
    }
    const to = toE164(match.rec.phone);
    if (!to) {
      console.log(`forgotPin: ${match.userId} has no usable phone`);
      return generic;
    }
    const lastRef = db().ref(`${ROOT}/forgotPinAt/${match.userId}`);
    const last = (await lastRef.get()).val();
    if (last && Date.now() - last < FORGOT_COOLDOWN_MS) {
      console.log(`forgotPin: ${match.userId} still on cooldown`);
      return generic;
    }
    await lastRef.set(Date.now());

    const pin = await assignPin(match.scope, match.site, match.userId, null);
    try {
      const client = require("twilio")(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({
        from: TWILIO_FROM_NUMBER.value(),
        to,
        body: `Refrigeration Tracker: your new PIN is ${pin}. If you didn't ask for this, tell your manager.`,
      });
      console.log(`forgotPin: texted new PIN to ${match.userId}`);
    } catch (err) {
      console.error(`forgotPin: text to ${match.userId} failed`, err && err.message);
    }
    return generic;
  }
);

// Exposed for the offline tests.
exports._test = {pinKey, migratePlaintextPins, assignPin, requireCaller};
