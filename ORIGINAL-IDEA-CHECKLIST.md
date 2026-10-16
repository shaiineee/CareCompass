# How this follows your sketches and notes

| Your intention | This release |
| --- | --- |
| Older adults first, caregivers secondary | Large readable daily actions; caregiver settings separated from daily Home |
| Greeting, daily task cards, expand, Ask and Done | Implemented; task-specific Ask pre-fills the exact instruction |
| Simple steps, original wording available | Source text and steps displayed together; source shortcut on Home |
| Upload → extract → explain → confirm → schedule | Text PDF and English image OCR; editable source-preserving drafts; confirmed tasks become calendar entries |
| Do not assume medicine dose or timing | Strength/dose fields are source-derived; unknown exact times need review; complex conditional schedules are blocked |
| Check ankles, short daily check-ins, follow-up | Check-ins with history and explicit demo rules; no invented three-second ankle test or safety reassurance |
| Teach-back in the person's own words | Basic source-word comparison, explicitly limited; not clinical comprehension verification |
| Mic and read-aloud | Browser speech APIs with permission/support requirements and type fallback |
| Medical Assistance everywhere | Persistent help button, caregiver approval and factual handover; Singapore emergency calling link requires user action |
| Home today versus calendar future | Home today's tasks; weekly calendar, dates, appointments and check-ins |
| Orange calendar dots | Implemented for appointment/check-in dates |
| Local background reminders | Saved inbox notices while server stays running; optional external sending |
| Caregiver notification and clinician summary | Exact-summary approval, local caregiver inbox, downloadable factual handover |
| Consent and traceability | Server-enforced approval, source quotes, rule receipts and care activity record |

## Intentionally not represented as finished

The Word notes envision full clinical translation, deeper LLM document understanding, voice commands that create calendar entries, a monthly calendar, a separate caregiver/clinician portal and Tencent hosting. Those are **not fully implemented**. Navigation/greeting translation is partial; voice input fills text rather than autonomously creating events; the calendar is week-based; hosting is local only. The optional AI adapter is unconfigured. These limits are documented rather than hidden.

Automatic “twice daily = after breakfast and dinner” scheduling was not introduced: the source may specify a different regimen. The user must confirm exact reminder times with the written plan/professional guidance. Worsening or worrying symptoms must not wait for a seven-day threshold.

This is a handover of a working prototype, not proof of clinical efficacy or a guarantee of competition compliance. Check the official handbook and record genuine Tencent tool usage before submission.
