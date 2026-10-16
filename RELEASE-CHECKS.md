# Release verification — 16 October 2026

Release 2.2.0; tested with Node.js 24.15.0 on Windows, using installed Chrome for browser checks.

- **27 automated API/unit checks passed.** Includes persistent sessions, task completion across restarts, source confirmation, schedule safeguards, check-in decisions, caregiver consent, provider result handling, local backup round trip, invalid-backup rejection, cloud disabled by default, and in-app reminders without contact details.
- **Desktop/mobile browser checks passed.** Includes saved completion, normal/urgent check-ins, unsupported questions, source review, confirmed scheduling, calendar navigation, caregiver approval, handover download, task-specific Ask, backup download/restore, Home source shortcut, responsive layout and service-setting credential fields.
- **Actual file-reading checks passed.** Text PDF extraction and English PNG OCR returned the real uploaded synthetic source. The test image's OCR confidence was 95%; this is not a general accuracy score or a medication safety guarantee.
- **Real background worker check:** see the script `scripts/handover-check.js`; it runs the 15-second worker with no browser and checks that a due synthetic reminder is saved in the local inbox. No external provider is involved.

Provider adapter tests use synthetic/mocked responses. No live generative AI account, real SMS/email delivery, cloud database or clinical validation was tested. No claim is made that this release satisfies every official competition rule.

Run again from the project folder with Node.js and dependencies installed:

    npm.cmd test
    npm.cmd run test:browser
    npm.cmd run test:documents
    node scripts/handover-check.js

Tests create isolated temporary data. Browser screenshots in artifacts/ are generated locally and excluded from distributable ZIPs.
