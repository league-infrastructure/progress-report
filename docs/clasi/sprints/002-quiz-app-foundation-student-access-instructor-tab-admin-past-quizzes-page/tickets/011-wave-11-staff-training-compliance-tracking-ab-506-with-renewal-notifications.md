---
id: '011'
title: "Wave 11 \u2014 Staff training compliance tracking (AB 506) with renewal notifications"
status: in-progress
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Wave 11 — Staff training compliance tracking (AB 506) with renewal notifications

## Description

As a California program, LEAGUE must track required staff trainings (AB 506
mandated-reporter, and other school/district-required policies) for every
instructor and volunteer. The admin needs to record, per person per training,
whether it's currently met, a link to that person's Google Drive folder holding
the documentation, and when it expires — and be notified when a training is
lapsing or unmet.

**Who:** every Pike13 staff member — both instructors and volunteers. A unified
`staff_profiles` record is created for each during Pike13 sync, keyed on the
Pike13 staff id (stable, present for all staff). Volunteers get a profile even
though they have no `instructors`/`users` record today.

**Records:** a catalog of `training_types` (AB 506 seeded by default). Each
`staff_trainings` row = staff × training with: `met` (yes/no), `driveUrl` (link
to their Drive folder — the admin manages the actual files in Drive), and
`expiresAt` (renewal date, nullable).

**Notify:** the admin is notified (in-app admin notification + a summary email)
when a training is **not met**, or its **expiry is within a window** (default
30 days). A scheduled/on-demand check produces the notifications.

Files are NOT uploaded into the app — only Drive links are stored (no Google
Drive API integration).

## Acceptance Criteria

- [ ] Schema + migration: `staff_profiles` (pike13StaffId unique, name, email,
      kind 'instructor'|'volunteer', active), `training_types` (name, description,
      active), `staff_trainings` (staffProfileId, trainingTypeId, met, driveUrl,
      expiresAt, notes, updatedAt) with a unique (staffProfileId, trainingTypeId).
- [ ] Pike13 sync upserts a `staff_profiles` row for every staff member
      (instructors AND volunteers), setting kind appropriately. Idempotent.
- [ ] AB 506 (and a small default set) seeded into `training_types` at startup.
- [ ] Admin API (admin-only):
      - `GET /api/admin/trainings` — every staff profile with their trainings
        (met, driveUrl, expiresAt) and a computed status per training.
      - `PUT /api/admin/trainings/:staffId/:trainingTypeId` — set met/driveUrl/
        expiresAt/notes.
      - `GET /api/admin/trainings/alerts` — the list of lapsing/unmet trainings.
      - `POST /api/admin/trainings/check` — run the check now: create admin
        notifications + send a summary email for anything unmet or expiring
        within the window.
- [ ] A `renewalWindowDays` (default 30) governs "expiring soon".
- [ ] New admin page `/admin/trainings`: table of staff × trainings with a
      yes/no checkbox, an editable Drive folder link, an expiry date, and a
      visual flag for unmet/expiring rows; a "Run check / notify" button.
- [ ] Nav: add a "Trainings" item to the admin layout.
- [ ] Notifications reuse the existing admin_notifications + SendGrid email.

## Testing

- **Existing tests to run**: full server suite, full client suite.
- **New tests to write**:
  - Server: sync creates staff_profiles for instructors + volunteers; PUT
    upserts a training record; alerts/check flags unmet + within-window-expiry
    and NOT met+far-future; check creates a notification and attempts an email.
  - Client: trainings page renders staff rows, toggling met calls PUT, an
    expiring row is flagged.
- **Verification command**: `npm run test:server` and the client vitest run.
