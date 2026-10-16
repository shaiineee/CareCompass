# Five-minute team demonstration

Opening: **CareCompass turns a professional care plan into simple daily actions, checks what the person understood, and helps them prepare an approved update for their caregiver. It supports care; it does not replace the clinician.**

1. **Home — 40 seconds.** Show the greeting, big task cards, time, Explain steps and Done. Complete the medicine task, refresh, and show completion is saved. Do not act out taking real medicine.
2. **Understand — 40 seconds.** Expand the ankle task and choose Ask about this task. Submit the prefilled question; show the exact source quotation and Read aloud. Explain that the default engine retrieves the confirmed plan; a generative API is optional and not connected.
3. **Teach-back — 40 seconds.** Choose Teach-back and enter a short explanation. Show the comparison and source. Say: this wording check flags details to review, not a clinical pass/fail assessment.
4. **Check-in — 45 seconds.** Record discomfort 2/10 and Better; show history. Then record 8/10 or Sudden change and show the human-help gate. Explain thresholds are demonstration rules, not approved medical pathways. Open Medical Assistance; do not click the actual calling link.
5. **Caregiver — 45 seconds.** In Profile choose a synthetic caregiver and enable sharing. Review the summary, explicitly approve, and show the local caregiver inbox. Download the factual handover. Say clearly that no external message is sent without a configured provider.
6. **Scanner — 40 seconds.** Add the supplied synthetic text/PDF/image. Show the extracted source and candidate times; nothing is scheduled until reviewed and confirmed. Explain OCR can misread instructions. Avoid inventing clinical steps to fill gaps.
7. **Calendar / backup — 30 seconds.** Add a team demo appointment. Download a backup in Team Setup. Optional service tiles show what is and is not connected.

## Prove reminders work without a browser

Do this separately or prepare it before the presentation:

1. Open Profile. Select **In-app inbox**, enable background reminders, and save. No contact details are necessary.
2. In Calendar add **Synthetic demo reminder**, dated today, at one minute from now in Singapore time. This is not a medication schedule.
3. Close the CareCompass browser tab, but leave the server window open and the computer awake.
4. After the reminder time plus 15 seconds, reopen http://localhost:3000 in the same browser. Your Home reminder inbox shows the saved notice. Team Setup's notification activity says **saved / local inbox**, not externally delivered.
5. Reopening/reloading should not duplicate that job. For a cleaner demo, complete any earlier due tasks first; enabling reminders can also create an overdue notice for today's unfinished tasks.

## Exact fallback wording for judges

- “This prototype uses synthetic care instructions, not real patient information.”
- “The source plan is authoritative; the app does not prescribe or change doses.”
- “Our current demo works locally. Live AI, email and SMS require provider configuration and end-to-end verification.”
- “Caregiver inbox review is a demonstration within this app. A separate authenticated caregiver service is future work.”
- “We will confirm competition tool-use and submission requirements against the official handbook; a runnable app alone does not prove eligibility.”
