// Renders tools/og.html into the link-preview card, site/img/og.png.
//
//   DOTVIRT=../dotvirt node tools/og.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOTVIRT = path.resolve(process.env.DOTVIRT ?? '../dotvirt');
const { chromium } = createRequire(path.join(DOTVIRT, 'web/package.json'))('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(path.resolve('tools/og.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'site/img/og.png' });
await browser.close();
