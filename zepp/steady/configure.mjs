import { readFileSync, writeFileSync } from 'node:fs';
const appId = Number(process.argv[2]);
if (!Number.isSafeInteger(appId) || appId < 1) throw new Error('Pass the app ID assigned to Steady by developer.zepp.com: npm run configure -- YOUR_APP_ID');
const manifest = JSON.parse(readFileSync(new URL('./app.template.json', import.meta.url)));
manifest.app.appId = appId;
writeFileSync(new URL('./app.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log('Configured the assigned Zepp app ID. Run npm run build.');
