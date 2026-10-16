# What this release actually does

## Works without external accounts

- Sketch-based Home to-do cards, expandable steps, task-specific Ask button and Done/undo.
- Plain-language, source-based guidance; original care-plan text remains visible. This is retrieval/rules by default, not a live generative model.
- PDF text reading, English PNG/JPG OCR, and pasted text; editable draft review and explicit confirmation before scheduling.
- Source-derived strengths/doses, AM/PM parsing and separate daily reminder occurrences. PRN, tapering and ambiguous abbreviations require clarification instead of automatic scheduling.
- Check-ins with saved history and transparent demo escalation rules; worsening symptoms do not wait for a week. Rules are illustrative, not clinically validated.
- Basic teach-back word comparison. It cannot verify comprehension or replace a professional.
- Calendar, saved appointments and task completion; Singapore timezone throughout scheduling.
- A persistent background worker saves due reminder notices while the browser is closed. Choose in-app delivery with no account. View notices on reopening; this is NOT phone push or an operating-system alarm.
- Caregiver permission, specific summary approval, factual handover download and a local demonstration caregiver inbox. Caregiver review is simulated in the same app, not a separate authenticated caregiver portal.
- Local backup export/restore, source review, large-text mode, responsive desktop/mobile layout and read-aloud where supported.
- Limited translated navigation/greetings. Clinical text, chat and most interface labels remain English; do not present this as full multilingual clinical support.

## Included but NOT connected in this release

- Generative AI: supply a compatible endpoint, model and key in Team Setup. The optional adapter checks quoted sources and selected unsupported changes, but these checks are not a guarantee of medical accuracy. Live account tests have not been done.
- Email: configure SMTP/app credentials or Resend plus a verified sender; enter recipient details in Profile. A normal email address alone cannot send messages.
- SMS: configure Twilio and an approved sender. Fees/verification may apply. No real email or SMS was sent in release testing.
- Legacy Supabase adapter: disabled unless explicitly opted in using your own project. No remote database is required and no unknown previous project credentials are included. MySQL has not been integrated.

## Not claimed

No clinician validation, diagnosis, medical advice generation, guaranteed warning detection, production security, multi-user identity, external caregiver delivery, phone push, always-on hosted service, comprehensive document understanding or competition acceptance. No automatic medicine dose selection or changes. Background processing stops when the server/computer stops.

The emergency calling link is for life-threatening emergencies in Singapore (995); it requires a phone-capable device and user action. Source: https://www.scdf.gov.sg/home/about-scdf/emergency-medical-services . Never test with a real call.
