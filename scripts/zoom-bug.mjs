import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Zoom in 2x via the toolbar
const zoomIn = page.locator('button[aria-label="放大"], button:has-text("放大")').first();
await zoomIn.click();
await zoomIn.click();
await zoomIn.click();
await page.waitForTimeout(500);

const codeBox = await page.locator('[data-node-id="r_code"]').boundingBox();
const tableBox = await page.locator('[data-node-id="r_table"]').boundingBox();
const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const tableA = await page.locator('[data-node-id="r_table_a"]').boundingBox();

console.log('boxes:', {codeBox, tableBox, codeA, tableA});

// Tight crop near the code→code_a line tip
await page.screenshot({
  path: '/tmp/zoom-code-line.png',
  clip: {
    x: Math.max(0, codeA.x - 30),
    y: Math.max(0, codeA.y - 30),
    width: 200,
    height: 200,
  },
});

await page.screenshot({
  path: '/tmp/zoom-table-line.png',
  clip: {
    x: Math.max(0, tableA.x - 30),
    y: Math.max(0, tableA.y - 30),
    width: 200,
    height: 200,
  },
});

await browser.close();
console.log('OK');
