'use strict';
// Rendert Text- und Logo-Karten als PNG: node cards.cjs liste.json
const path = require('node:path');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
(async () => {
  const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const b = await playwright.chromium.launch();
  for (const c of list) {
    const p = await b.newPage({ viewport: { width: c.w, height: c.h } });
    await p.goto('file://' + path.join(__dirname, 'scenes', 'card.html') + '?' + new URLSearchParams(c.params));
    await p.waitForTimeout(150);
    await p.screenshot({ path: c.out, omitBackground: !!c.transparent });
    await p.close();
  }
  await b.close();
})();
