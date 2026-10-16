require('dotenv').config({ quiet: true });
const { loadConfiguration } = require('../lib/configuration');
const { migrateDatabase } = require('../lib/cloud');
(async () => { await loadConfiguration(); const result = await migrateDatabase(); console.log(result.message); if (!result.ok) process.exitCode = 1; })().catch(() => { console.error('The backup table could not be created. Check the project owner’s PostgreSQL connection details.'); process.exitCode = 1; });
