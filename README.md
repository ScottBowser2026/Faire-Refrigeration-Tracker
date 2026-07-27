# Refrigeration Tracker

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
| **Accounting** | One site | Sees a dedicated Costs tab only — a running total of all outside-service spending, plus per-unit breakdowns. Can add outside-service cost entries (vendor, cost, invoice #, date, notes, invoice photo) to *existing* open tickets. Cannot open new tickets, close tickets, or access anything else. |

## Costs tab (F&B Manager, Superadmin, and Accounting)

- **F&B Manager/Superadmin** see this as a third tab, alongside Dashboard and Admin Panel
- **Accounting** sees this as their entire experience — logging in goes straight here, nothing else
- Shows a site-wide all-time total at the top, then every unit with logged costs (open or closed tickets), sorted highest-spend first
- Clicking a unit opens its ticket — Accounting can add a new outside-service call (now including an optional invoice photo) but can't open a brand-new ticket or close one; if a unit has no ticket yet, Accounting sees a message explaining only F&B Manager/Superadmin can start one
- **"Repeat Repairs" section** — sits above the per-unit list, showing any unit with 2+ maintenance tickets ever (open or closed), sorted worst-first. This is computed independently of cost data, so it still catches units with repeat in-house repairs even if no outside-service cost was ever logged.
- **Dashboard cards flag it too** — any unit with 2+ tickets ever shows a red "⚠️ Repeat repairs — Xx on record" badge, so F&B Manager can spot chronic problem equipment (candidates for replacement rather than another repair) without needing to dig through history.

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

- **"Clear" option** — when opening a failing unit that has no ticket yet, F&B Manager/Superadmin see a "Clear Report" option below the ticket form for cases that don't need a formal ticket (checked in person, resolved on its own, etc.). **Notes are required** to clear — it can't be dismissed silently. Once cleared, the incident shows a "Cleared" status with who cleared it and why, right on the row.

## Alerts & Incidents — now ticket-aware

- Each incident row shows **Booth first** (bold), equipment name second — matching the "location leads" convention used elsewhere
- **"Open" button** (F&B Manager/Superadmin only) — for any unresolved incident with no maintenance ticket yet, opens the Mark for Maintenance form pre-filled with the failure reason as the description
- **"View Ticket" button** — if a ticket already exists for that unit, takes you straight to it instead
- **Status is ticket-aware** — shows "Ticket Open" once a ticket exists (not just "Open"), and only shows "Resolved" once a later good check is logged. It stays visible and actionable until a Maintenance worker or F&B Manager actually closes the ticket — not just whenever the readings happen to look fine again on their own.

## Test / Sandbox site (Superadmin only)

A 5th site, `test`, exists purely for Superadmin to try things — new units, new people, new tickets — without touching real PARF/SRF/KRF/GARF data at all. It works exactly like a real site (own units, own Site Users, own Notify List, own Daily Reports), fully isolated in the database under `refrigeration/sites/test/...`.

- Only appears in the Superadmin's site-switcher dropdown — no one else ever sees it or can log into it unless a Superadmin deliberately adds a test person there
- **Deliberately excluded** from the Lancelot Management snapshot and the All Faires people list, so test data never skews real cross-site reporting
- Switch to it anytime via the site-switcher, make changes freely, switch back to a real site when done

## Phone number prompt on login

If someone logs in and has no phone number on file (any role — Superadmin, F&B Manager, User, Maintenance, Accounting, Lancelot Management), a quick prompt appears asking for one. It can be skipped ("Skip for now"), and only asks once per browser session — won't nag on every page reload.

## Service ID (tag/serial number)

- Each unit has a **Service ID** field (e.g. "RB-014" for Rufus Brubaker-serviced units, or "PARF-014" by site) — settable directly via Edit
- **If a unit doesn't have one yet, every routine check prompts for it** (required field) until it's entered once — after that, it's saved permanently and won't ask again
- This applies in both the User's check form and the F&B Manager's Log Entry modal
- The Dashboard card shows the Service ID once recorded, or a red "Service ID not recorded yet" flag if it's still missing — an easy way to see which units still need this filled in

## Compliance tracking

- Tracks three things per check: **temperature**, **fans**, and **compressor** — a compressor-down reading counts as out-of-compliance the same way fans-down does, across the card, reports, and the compliance streak
- Each unit's card shows "X days in compliance" or "X days out of compliance," computed from logged routine checks
- A 14-day fleet compliance chart and an auto-generated Alerts & Incidents feed sit at the top of the Dashboard
- History modal splits into two tabs per unit: **Routine Checks** vs. **Maintenance & Repairs**

## Login & PIN reset

- Same visual layout as Faire QC Tracker and Faire Punch List
- Forgot PIN is email-based with a deliberately vague response either way

## Notify List

- Per-site, admin-managed list of people who receive flagged-unit alerts, not-checked reports, and master reports via EmailJS
- Not tied to login access

## Add to Home Screen

The app now has a proper icon and app manifest, so it installs as a real home-screen app instead of a plain bookmark:
- **iPhone (Safari):** tap the Share icon → "Add to Home Screen"
- **Android (Chrome):** tap the ⋮ menu → "Add to Home Screen" / "Install app"

Opens full-screen with its own icon, no browser address bar.

## Files

- `index.html` — the entire app (single file)
- `CNAME` — points this repo at refrigeration.lancelotbiz.com (do not delete)
- `manifest.json`, `icon-192.png`, `icon-512.png` — enable "Add to Home Screen" as a real app

## Site Users: CSV export, CSV import, and bulk-delete

In the Site Users panel:
- **Download CSV** — exports the current site's Site Users (name, email, phone, role, PIN) as a file, useful as a backup before making bulk changes
- **Download Template** — downloads a blank example file with 3 sample rows showing the expected format, for building a fresh import from scratch
- **Import from CSV** — same paste-or-upload pattern as equipment import. Columns: `FirstName,LastName,Email,Phone,Role,PIN` (Role should read "User", "F&B Manager", or "Maintenance"; leave PIN blank to auto-generate one)
- **Delete All Site Users** (Superadmin only) — wipes every F&B Manager/User/Maintenance account at the current site in one action, with two confirmation prompts since it can't be undone. **Superadmins and Lancelot Management accounts are never touched by this** — it only ever affects site-scoped people.

In a combined **Danger Zone** panel (Superadmin only, red-bordered, at the bottom of Admin Panel):
- **Delete All Site Users** — wipes every F&B Manager/User/Maintenance account at the current site, behind two confirmation prompts. Superadmins and Lancelot Management are never touched.
- **Delete All Units** — wipes every unit at the current site, along with all their history, maintenance tickets, and PM tasks, behind two confirmation prompts. Use this to get a clean slate before re-importing corrected equipment data via CSV.

**Note:** if a unit's Type field seemed to silently revert after editing — this was a real bug from equipment categories being expanded (old units still had the retired "cooler"/"freezer" values, which didn't match any current dropdown option). This is now auto-migrated to the new categories the moment the app loads, so it shouldn't happen going forward.

## CSV Import (bulk-create units)

F&B Manager/Superadmin see **"Import from CSV"** and **"Download Template"** buttons next to Add Unit.

**Download Template** generates a ready-to-fill CSV:
- If the site already has units, it pre-fills one row per existing Location/Booth (equipment columns left blank) — ready to fill in equipment for each known location
- If the site has no units yet, it downloads a blank example instead, showing the expected format with two sample rows

Paste CSV content or upload a file with this column layout:

```
location,Equipment,Equipment,Equipment,...
Absinthe Bar,Walk in Cooler,,,
Mansion,Upright Refrigerator #1,Upright Refrigerator #2,,
```

- Any number of Equipment columns is fine — blank cells are skipped
- One unit gets created per non-blank equipment cell; the Location column becomes that unit's **Booth**
- Equipment type is auto-detected from the text (walk-in cooler/freezer, upright refrigerator/freezer, chest freezer, bain marie, glycol chiller — anything else defaults to "Other"), shown in an editable preview before anything is created
- New units default to 33–40°F target range and "Always on" — adjust individually afterward if needed

## Unit assignment & the User checklist

- **Add/remove people directly on the card** — F&B Manager and Superadmin see each unit's assigned people as small removable chips right on the Dashboard card, with a "+ Add person…" dropdown underneath. This is now the *only* place to manage unit assignments — the separate Unit Assignments panel was removed as redundant.
- **Multiple Users can be assigned to the same unit** — same multi-select works from the unit's Edit form too (Ctrl/Cmd+click or tap multiple on mobile), in addition to the card chips
- **First one to log a check clears it for everyone** — since "checked today" is tracked per-unit, not per-person, as soon as any assigned User logs a check, that unit disappears from every other assigned User's list too, not just theirs
- Users no longer see the full unit grid or a scrollable list — logging in shows the cascading Booth→Equipment check form described above under "User check-logging form"
- **Booth field** — each unit now has a separate Booth field (in addition to Location) specifically for grouping equipment that belongs to the same booth. Typing suggests existing booth names as you type (autocomplete), so reusing the exact same name is easy instead of risking a typo creating a duplicate group. Existing units will need this filled in via Edit before they group meaningfully — until then they fall back to grouping by Location, then "Ungrouped."
- **Equipment types expanded** — the Type dropdown now matches real categories: Walk-in Cooler, Walk-in Freezer, Upright Refrigerator, Upright Freezer, Chest Freezer, Bain Marie, Glycol Chiller, or Other (previously just Cooler/Freezer/Bain Marie). Existing units keep their old type value until edited — worth a pass through Edit on each one alongside setting its Booth.

## User check-logging form

Logging in as a User now shows a single polished check form (matching Faire QC Tracker's visual style), not a scrollable list:

- **Booth** dropdown — only booths with equipment still assigned to you and not yet handled today
- **Equipment** dropdown — cascades from the selected Booth, showing only that booth's pending equipment
- **Entry type** — Routine check (shows Temp/Fans fields), Maintenance, Repair (shows Performed By), Cleaning, or Unit is off (with confirmation)
- **Check time** — defaults to now, editable
- **Checked by** — auto-filled, read-only
- **Photo** — optional
- **Notes** — optional

Submitting clears that equipment from the dropdowns immediately and resets the form for the next entry — no navigating back and forth. F&B Manager and Superadmin are unaffected; they still use the full Dashboard grid with the original "Log entry" modal on each card.

## "Unit is off" option

- When logging an entry, Users (and anyone else) can select **"Unit is off"** instead of a routine check — shows a confirmation prompt ("Confirm: mark [unit] as OFF for today?") before saving
- An off unit shows a distinct "OFF" badge on its card, disappears from the User's daily checklist (same as a completed check), and is excluded from both compliance percentages and not-checked reports for that day — it's treated as neutral, not as a failure
- Resets automatically the next calendar day, same pattern as checks and PM tasks

## Daily Report + deep-linking (frontend ready, texting backend pending)

- **Submit Daily Report** button on the Dashboard compiles the current state of every unit at the site — compliant / flagged / not-checked — into a saved snapshot, viewable later under "Daily Reports"
- Deep-linking is built in: a URL like `?unit=UNITID&view=ticket`, `?unit=UNITID&view=pm`, or `?report=REPORTID` opens straight to that specific ticket, PM task, or report after login, instead of the general dashboard
- **Not yet wired up:** the actual text message that says "Daily report for [date] at [site] is available for viewing" (and similar texts for ticket/PM assignment) requires a Twilio Cloud Functions backend for this tracker, which doesn't exist yet — see `notifyDailyReportReady()` in the code for exactly where that hook goes in

## Related sites

- Hub / Guild Board: https://guildboard.lancelotbiz.com/
- Faire QC Tracker: https://foodqc.lancelotbiz.com/
- Faire Punch List: https://punchlist.lancelotbiz.com/
- Shared legal pages (for trackers with SMS programs): https://legal.lancelotbiz.com/
