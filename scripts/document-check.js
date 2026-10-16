const { chromium } = require('playwright');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'carecompass-documents-'));
  const app = await createApp({ dataFile: path.join(directory, 'state.json'), skipExternal: true });
  const server = app.listen(0, 'localhost');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    const executablePath = process.env.BROWSER_PATH || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 500 }, deviceScaleFactor: 1 });
    await page.setContent('<html><body style="padding:40px;font:28px Arial;background:white;color:black"><h1 style="font-size:36px">SYNTHETIC CARE PLAN</h1><p>Check your ankles daily at 19:00.</p><p>Sit safely. Record any change.</p></body></html>');
    const pdf = await page.pdf({ format: 'A4' });
    const image = await page.screenshot();
    for (const [name, buffer, type, method] of [['synthetic-plan.pdf', pdf, 'application/pdf', 'PDF text extraction'], ['synthetic-plan.png', image, 'image/png', 'English OCR']]) {
      const body = new FormData(); body.append('file', new Blob([buffer], { type }), name);
      const response = await fetch(`http://localhost:${server.address().port}/api/plans/upload`, { method: 'POST', headers: { 'X-CareCompass-Client': 'web' }, body, signal: AbortSignal.timeout(120000) });
      const result = await response.json();
      assert.equal(response.status, 201);
      assert.equal(result.method, method, result.warning);
      assert.match(result.sourceText, /ankles/i);
      assert.ok(result.candidates.length > 0);
      console.log(`PASS ${name}: ${result.method}${result.confidence === undefined ? '' : `, OCR confidence ${result.confidence}%`}; original source retained and task candidates created`);
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
