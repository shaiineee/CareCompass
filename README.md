# CareCompass — CareForge handover

A local, working hackathon prototype for older adults following a professional long-term care plan, with family caregivers as secondary users.

**Start with [START-HERE.md](START-HERE.md).** Run on http://localhost:3000.

- [DEMO-GUIDE.md](DEMO-GUIDE.md): a five-minute presentation, including a genuine background reminder test.
- [FEATURE-STATUS.md](FEATURE-STATUS.md): implemented features, optional connections and honest limits.
- [TEAM-HANDOFF.md](TEAM-HANDOFF.md): GitHub workflow and remaining competition checks.
- [samples/synthetic-care-plan.txt](samples/synthetic-care-plan.txt): a safe upload/paste example.

The supplied Windows launcher uses Node.js 22+. Dependencies and English OCR language data are bundled in the ready ZIP. No Supabase, MySQL, API key or email account is required to demonstrate the core journey. Run code from a trusted source only.

## Technology

Plain HTML/CSS/JavaScript frontend, Node.js/Express routing, local JSON persistence, PDF text extraction, Tesseract English image OCR. Optional chat-completions, SMTP/Resend and Twilio adapters are included but unconfigured. Legacy Supabase code is opt-in only, disabled by default; no previous project's credentials are included.

For development: `npm.cmd ci`, `npm.cmd start`. Automated checks: `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run test:documents`. Browser checks need installed Chrome/Edge (or BROWSER_PATH). Development tests use isolated temporary records, not your app data.

## Safety and privacy

Synthetic demonstration only. Not a medical device, diagnosis, prescription, emergency monitor or clinically validated triage service. Exact source instructions stay visible. OCR and AI can be wrong; confirm every task and schedule against the original. Conditional, tapering and ambiguous medication schedules are blocked from automatic scheduling. Ask a professional about uncertainty; do not change a dose using this prototype.

Data is stored unencrypted on this computer, separated by browser cookie, without production authentication. Do not use real patient information, expose the server publicly, commit data or API keys to GitHub, or treat a local caregiver inbox as a delivered message. Local backups contain care records and must be stored privately.
