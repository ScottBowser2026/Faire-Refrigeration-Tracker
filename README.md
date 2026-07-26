## Refrigeration Tracker

Live at: https://refrigeration.lancelotbiz.com/

Multi-site cooler/freezer temperature and fan compliance tracker, covering PARF, SRF, KRF, and GARF.

## Data & sites

- One shared Firebase project (`refrigeration-tracker`), with each site's units, users, and notify list kept separate under `refrigeration/sites/{siteKey}/...`
- Site keys: `parf`, `srf`, `krf`, `garf`
- On first load, the app auto-migrates any old single-site data into `sites/parf` — no manual export/import needed
- Superadmins (`refrigeration/superadmins`) and Lancelot Management accounts (`refrigeration/lancelotManagement`) are stored globally, not tied to one site
- **PINs must be unique system-wide** — across Superadmins, Lancelot Management, and every site's Site Users combined. Checked on both add and edit, so two different people can never silently collide.

## Roles

| Role | Scope | Can do |
|---|---|---|
| **Superadmin** | All sites | Everything below, plus switch between sites, manage Superadmins & Lancelot Management accounts, see the All Faires people list |
| **F&B Manager** | One site | Add/edit/delete units, log checks, open/manage/close maintenance tickets, assign tickets & PM tasks to specific Maintenance workers, log outside-service costs, manage that site's Manage Access & Notify List |
| **User** | One site | Log routine checks and maintenance/repair/cleaning entries; no access to Admin Panel |
| **Maintenance** | One site | Sees a dedicated, minimal view only — units with an open maintenance ticket **assigned to them** (or unassigned), plus any due PM tasks assigned to them (or unassigned). Can add dated notes/photos to a ticket. Cannot see costs, cannot close tickets, no access to Admin Panel |
| **Lancelot Management** | All sites, read-only | Sees only a cross-site snapshot. No editing power anywhere |

Every role's person record has separate First Name / Last Name fields, plus email, phone, and PIN.

## Adding people — PIN is optional

When adding anyone (Site User, Superadmin, or Lancelot Management), the PIN field can be left blank — the app auto-generates a unique one. If the person has an email on file, their new PIN is emailed to them automatically. A PIN can still be typed manually instead, if preferred.

## Navigation (F&B Manager / Superadmin)

Two tabs replace what used to be one long scrolling page:
- **Dashboard** — fleet compliance chart, alerts & incidents, units grid, maintenance tickets overview
- **Admin Panel** — Superadmins, Lancelot Management, Site Users, Notify List

Superadmins get a third tab:
- **All Faires** — every person across all 4 sites in one list, each row with a "Switch to this site" button

In Manage Access, every person row is **read-only by default** — click **Edit** to make fields editable, **Save** to commit, or **Cancel** to back out. **Delete** replaces "Remove" throughout. The last remaining Superadmin can't be deleted — the button is disabled outright until a second Superadmin exists.

## Lancelot Management snapshot (read-only, cross-site)

Per site, shows:
- Units tracked, current compliance % (temperature/fans), and **checking compliance %** (units checked on schedule, not stale)
- Total checks logged (all-time)
- Maintenance tickets open / closed (all-time)
- PM tasks completed vs. tracked
- Total outside-service cost, all-time

The same "checking compliance %" also appears in the header stat-strip on the regular Dashboard.

## Maintenance ticket workflow (reactive repairs)

1. F&B Manager clicks **"Mark for Maintenance"** on a unit, gives a reason, and can **assign it to a specific Maintenance worker** at that site (or leave it unassigned, visible to all Maintenance workers there)
2. Assigned tickets only show up on that specific worker's list; unassigned ones show to everyone with the Maintenance role at that site
3. Anyone with ticket access can add dated notes + photos over multiple days
4. F&B Manager can **reassign** a ticket at any point from within the ticket view
5. **F&B Manager only:** logs outside-service calls — vendor, cost, service date, invoice #, description
6. **F&B Manager only:** closes the ticket, which archives it into the unit's permanent history (`maintenanceHistory`)

## PM Tasks (scheduled preventive maintenance)

- F&B Manager creates a task per unit: name, interval in days, and can **assign it to a specific Maintenance worker** (or leave unassigned)
- Due/overdue assigned tasks show only on that worker's "Scheduled PM Due" list; unassigned ones show to everyone
- Marking a task done logs it to the unit's history and resets the countdown

## Compliance tracking

- Each unit's card shows "X days in compliance" or "X days out of compliance," computed from logged routine checks
- A 14-day fleet compliance chart and an auto-generated Alerts & Incidents feed sit at the top of the Dashboard
- History modal splits into two tabs per unit: **Routine Checks** vs. **Maintenance & Repairs**

## Login & PIN reset

- Same visual layout as Faire QC Tracker and Faire Punch List
- Forgot PIN is email-based with a deliberately vague response either way

## Notify List

- Per-site, admin-managed list of people who receive flagged-unit alerts, not-checked reports, and master reports via EmailJS
- Not tied to login access

## Files

- `index.html` — the entire app (single file)
- `CNAME` — points this repo at refrigeration.lancelotbiz.com (do not delete)

## Unit assignment & the User checklist

- F&B Manager assigns each unit to a specific **User** (via the unit's Edit form — same pattern as QC Tracker's zone-manager-per-booth)
- Users no longer see the full unit grid — logging in shows **"My Units to Check"**, a scrolling list of only their assigned units that haven't been checked yet today
- As soon as a User logs a routine check, that unit disappears from their list — it resets automatically the next calendar day
- F&B Manager/Superadmin still see every unit in the normal grid, with an "Assigned to: [name]" line on each card

## Daily Report + deep-linking (frontend ready, texting backend pending)

- **Submit Daily Report** button on the Dashboard compiles the current state of every unit at the site — compliant / flagged / not-checked — into a saved snapshot, viewable later under "Daily Reports"
- Deep-linking is built in: a URL like `?unit=UNITID&view=ticket`, `?unit=UNITID&view=pm`, or `?report=REPORTID` opens straight to that specific ticket, PM task, or report after login, instead of the general dashboard
- **Not yet wired up:** the actual text message that says "Daily report for [date] at [site] is available for viewing" (and similar texts for ticket/PM assignment) requires a Twilio Cloud Functions backend for this tracker, which doesn't exist yet — see `notifyDailyReportReady()` in the code for exactly where that hook goes in

## Related sites

- Hub / Guild Board: https://guildboard.lancelotbiz.com/
- Faire QC Tracker: https://foodqc.lancelotbiz.com/
- Faire Punch List: https://punchlist.lancelotbiz.com/
- Shared legal pages (for trackers with SMS programs): https://legal.lancelotbiz.com/
