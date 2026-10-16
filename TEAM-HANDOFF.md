# Team handoff and GitHub

## What to send teammates

Send **CareCompass-Ready.zip** for immediate running and tell them to read START-HERE.md. Each extracted copy runs locally on its own computer. A localhost URL is not a shareable public website. Individual browsers/computers do not synchronise care records automatically.

For the repository, merge the application source into a separate branch first. Keep any existing teammate changes and review conflicts; this release does not automatically update GitHub.

Commit: app.js, public/, lib/, package.json, package-lock.json, scripts/, tests/, samples/, docs, .env.example, launcher and .gitignore. Do not commit node_modules/, .cache/, data/, .env, downloaded backups, screenshots with personal information, credentials, or generated test artifacts. The source ZIP is convenient for this; teammates can run npm.cmd ci after cloning.

If any previous project keys were ever uploaded to GitHub, treat them as exposed and have their owner revoke/rotate them. Deleting a file from a new commit does not remove older Git history.

## Responsibilities left

1. **All:** rehearse DEMO-GUIDE.md and test on the actual presentation laptop. Confirm port 3000, audio and screen size before presenting.
2. **Clinical/content reviewer:** review care-plan examples, plain-language explanations, warning pathways and teach-back limitations. Do not use this for real care before professional review and proper security work.
3. **Integration owner (optional):** choose AI/email/SMS services; configure private keys locally; test with authorised synthetic recipients and record actual provider results. Do not buy services or send sensitive data just to complete the demo.
4. **Submission owner:** confirm current official challenge requirements, deadline/timezone, required deliverables, allowed prebuilt code, IP/licensing, privacy and required Tencent tool usage. Save evidence of the team's real CodeBuddy/WorkBuddy/Miora use; do not claim that this local default engine is a Tencent model.

## Competition alignment, not certification

The supplied poster names a healthcare challenge for intelligent long-term self-care support. This prototype's older-adult daily-plan journey aligns with that direction. The poster advertises development with Tencent tools and a 16 October 2026 submission date, but a complete official rules/handbook audit has not been performed for this release. Verify the exact deadline and submission checklist yourself before uploading. A date on a poster is not evidence of an extension or a particular cutoff time.

## Before any public deployment

This release intentionally accepts only local connections. It uses per-browser cookies, not authenticated patient/caregiver accounts. Add proper authentication, authorisation, encrypted transport/storage, backups, hosting, retention/deletion policy, consent management and clinician-approved workflows before considering a real deployment. Do not disable the local-only checks to share it publicly.
