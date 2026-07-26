Refrigeration Tracker

Live at: https://refrigeration.lancelotbiz.com/

Multi-site cooler/freezer temperature and fan compliance tracker, covering PARF, SRF, KRF, and GARF.

Data & sites
One shared Firebase project (refrigeration-tracker), with each site's units, users, and notify list kept separate under refrigeration/sites/{siteKey}/...
Site keys: parf, srf, krf, garf
On first load, the app auto-migrates any old single-site data into sites/parf — no manual export/import needed
Superadmins are stored globally at refrigeration/superadmins (not tied to one site)
Roles
Role	Scope	Can do
Superadmin	All sites	Everything below, plus switch between sites, manage Superadmins, see an all-sites people overview
F&B Manager	One site	Add/edit/delete units, log checks, open/manage/close maintenance tickets, log outside-service costs, create PM tasks, manage that site's Manage Access & Notify List
User	One site	Log routine checks and maintenance/repair/cleaning entries; no access to Manage Access
Maintenance	One site	Sees a dedicated, minimal view — only units with an open maintenance ticket, plus any due PM tasks. Can add dated notes/photos to a ticket. Cannot see costs, cannot close tickets, no access to Manage Access

All 4 people-managing fields (name, email, phone, PIN) apply to every role.

Maintenance ticket workflow (reactive repairs)
F&B Manager clicks "Mark for Maintenance" on a unit, gives a reason → opens a ticket
Unit now appears on that site's Maintenance workers' list
Anyone with ticket access can add dated notes + photos over multiple days (built for repairs spanning several visits)
F&B Manager only: logs outside-service calls — vendor, cost, service date, invoice #, description
F&B Manager only: closes the ticket, which archives it into the unit's permanent history (maintenanceHistory)
PM Tasks (scheduled preventive maintenance)

Separate from tickets — these recur on their own schedule, no opening/closing needed each cycle.

F&B Manager creates a task per unit: name + interval in days (presets: weekly/biweekly/monthly/quarterly/semiannual, or custom)
App computes next-due date from the interval and last completion
Due/overdue tasks show as a badge on the unit card and in a dedicated "Scheduled PM Due" section on the Maintenance worker's list
Marking a task done logs it to the unit's history and resets the countdown
Compliance tracking
Each unit's card shows a running day-count: "X days in compliance" or "X days out of compliance," computed from logged routine checks (not a separate counter — can't drift out of sync)
A 14-day fleet compliance chart and an auto-generated Alerts & Incidents feed sit at the top of the dashboard
History modal splits into two tabs per unit: Routine Checks vs. Maintenance & Repairs
Login & PIN reset
PIN-based login, same visual layout as Faire QC Tracker and Faire Punch List (for consistency across all trackers)
Forgot PIN is email-based with a deliberately vague response either way ("If that email is on file, a new PIN has been sent to it.") — doesn't reveal whether an account exists
Notify List
Per-site, admin-managed list of people who receive flagged-unit alerts, not-checked reports, and master reports via EmailJS
Not tied to login access — someone can be on the Notify List without being a Manage Access user, or vice versa
Files
index.html — the entire app (single file)
CNAME — points this repo at refrigeration.lancelotbiz.com (do not delete)
Related sites
Hub / Guild Board: https://guildboard.lancelotbiz.com/
Faire QC Tracker: https://foodqc.lancelotbiz.com/
Faire Punch List: https://punchlist.lancelotbiz.com/
Shared legal pages (for trackers with SMS programs): https://legal.lancelotbiz.com/
