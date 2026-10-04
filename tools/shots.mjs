// Captures the site's screenshots from the showcase fixture (tools/showcase.mjs).
//
//   DOTVIRT=../dotvirt node tools/shots.mjs [out-dir]
//
// Playwright comes from the dotvirt checkout, so this repo carries no
// node_modules.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const DOTVIRT = path.resolve(process.env.DOTVIRT ?? '../dotvirt');
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.FIXTURE_PORT ?? 4199}`;
const OUT = path.resolve(process.argv[2] ?? 'shots');

const require = createRequire(path.join(DOTVIRT, 'web/package.json'));
const { chromium } = require('playwright');

fs.mkdirSync(OUT, { recursive: true });

const main = (page) => page.locator('main');

// Each view leaves the page in the state worth a screenshot.
const views = {
	async inventory(page) {
		await page.goto(BASE + '/compute?tab=vms');
		await main(page).locator('tbody tr').first().waitFor();
	},
	async vm(page) {
		await page.goto(BASE + '/vm/web-prod/web-1');
		await page.getByRole('button', { name: /Edit Settings/ }).waitFor();
	},
	async changes(page) {
		await page.goto(BASE + '/changes/storefront');
		await main(page).getByText('Manifest diff', { exact: false }).first().click();
	},
	async security(page) {
		await page.goto(BASE + '/networking?tab=security');
		await main(page).getByText('Gateway Firewall').first().waitFor();
		// Selects in page order: tenant filter, source namespace and VM,
		// destination kind, then protocol once the kind is an external address.
		const sel = main(page).locator('select');
		await sel.nth(1).selectOption('payments-prod');
		await sel.nth(2).selectOption({ label: 'ledger-1' });
		await sel.nth(3).selectOption('ip');
		await main(page).locator('input[placeholder*="."]').first().fill('8.8.8.8');
		await main(page).locator('select', { hasText: 'UDP' }).selectOption('UDP');
		await main(page).getByPlaceholder('any').fill('53');
		await main(page).getByRole('button', { name: 'Trace', exact: true }).click();
		await main(page).getByText(/Denied/).first().waitFor();
	},
	async topology(page) {
		await page.goto(BASE + '/networking');
		await main(page).getByText('Provider Gateway').first().waitFor();
	},
};

// The poster stands in for the demo video, so it shares its 16:9 frame and
// light theme; the tour is shot in the theme the site itself wears.
const shots = [
	{ file: 'poster', view: 'vm', scheme: 'light', viewport: { width: 1600, height: 900 } },
	...Object.keys(views).map((view) => ({
		file: view,
		view,
		scheme: process.env.TOUR_SCHEME ?? 'dark',
		viewport: { width: 1440, height: 900 },
	})),
];

const browser = await chromium.launch();
const sessions = new Map();

async function session({ scheme, viewport }) {
	const key = `${scheme} ${viewport.width}x${viewport.height}`;
	if (!sessions.has(key)) {
		const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
		const page = await context.newPage();
		await page.goto(BASE + '/');
		await page.waitForSelector('textarea');
		await page.fill('textarea', 'fixture-token');
		await page.click('button[type="submit"]');
		await page.locator('aside').getByRole('link', { name: 'Compute' }).waitFor();
		sessions.set(key, page);
	}
	return sessions.get(key);
}

for (const shot of shots) {
	const page = await session(shot);
	await views[shot.view](page);
	await page.mouse.move(0, 0);
	// Charts and skeletons settle after the data lands.
	await page.waitForTimeout(600);
	const file = path.join(OUT, `${shot.file}.png`);
	await page.screenshot({ path: file });
	console.log(file);
}

await browser.close();
