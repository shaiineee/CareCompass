# Start CareCompass in 3 steps

1. Right-click **CareCompass-Ready.zip → Extract All**. Open the extracted CareCompass-Ready folder. Do not run it inside the ZIP.
2. Double-click **Start-CareCompass.cmd**. If asked, install Node.js 22 or newer from https://nodejs.org first. This computer already had Node.js when the release was tested.
3. When the window says the app is running, open **http://localhost:3000** in Chrome or Edge. Keep the server window open.

No database, email login, AI key, build command or separate frontend server is needed. Bundled dependencies allow the core app to run without installation downloads. English OCR data is also included. Voice input may require your browser's online speech service and microphone permission.

## Your first demonstration

- The synthetic Mr Rahman profile loads automatically.
- Home shows today's tasks. Expand **Explain steps**, ask about a task, or mark it done.
- Try **Check-in**, **Ask Compass**, **Calendar**, and **Care circle**.
- Use **Add care plan → synthetic sample**, or upload the supplied sample file. Check the original wording and all times, then explicitly confirm.
- **Medical Assistance** is available on every screen. Never place a real emergency call during testing.
- For background reminders without accounts: open Profile, select **In-app inbox**, enable reminders and save. See DEMO-GUIDE.md for a one-minute test.

## Saving and moving records

The server creates `data/app-state.json` automatically. A previous-file recovery copy is kept as `data/app-state.json.bak`. The browser cookie selects your profile: use the same browser, localhost address and port. Another browser starts a separate synthetic profile.

Before moving computers or clearing cookies, choose **Team Setup → Download my backup**. On the new copy, choose **Restore a backup** and confirm replacement. Reminders and caregiver permission turn off after restore; review them before reenabling. Service credentials and sending queues are not exported.

The ready ZIP starts with clean demonstration records. It does not contain private records or service keys from any earlier version. To bring existing records forward, export from the earlier app if supported; otherwise keep its entire original data folder and app safely. Do not overwrite your only copy.

## Stop and restart

Press Ctrl+C in the server window to stop. Double-click the launcher to restart. Saved records remain in the extracted folder. The computer must remain awake with the server running for background processing; closing just the browser is okay.

## If something goes wrong

- **Port 3000 is already in use:** stop the older CareCompass terminal, then launch again. Do not run two copies against the same records. If you intentionally choose another port, set PORT and open that port's address.
- **npm is blocked by PowerShell:** use the launcher or `npm.cmd start`, not `npm start`.
- **Missing dependencies after cloning GitHub:** run `npm.cmd ci` once with internet access. The ready ZIP already includes them.
- **Browser says connection refused:** the server window must remain open; read its error. Refresh only after it prints the running message.
- **Image/PDF text is incomplete:** upload a clearer PNG/JPG or paste the exact wording. Scanned/image-only PDFs need an image upload or manual text; English OCR is not guaranteed accurate.
- **Read-aloud/voice does not work:** use Chrome/Edge, check audio/microphone permissions, or type instead. Browser support varies.
- **Email/SMS says blocked:** that is expected without a provider. Use the local inbox; do not claim a message was sent.

Do not delete your saved data to troubleshoot. Make a private copy first.
