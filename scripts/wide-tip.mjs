import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Get the box of code_a, table_a
const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const code = await page.locator('[data-node-id="r_code"]').boundingBox();
const imageA = await page.locator('[data-node-id="r_image_a"]').boundingBox();
const image = await page.locator('[data-node-id="r_image"]').boundingBox();
const tableA = await page.locator('[data-node-id="r_table_a"]').boundingBox();
const table = await page.locator('[data-node-id="r_table"]').boundingBox();

// Wider view of code line
await page.screenshot({
  path: '/tmp/wide-code.png',
  clip: {
    x: codeA.x - 80,
    y: codeA.y - 5,
    width: 200,
    height: 50,
  },
});

// Wider view of image line
await page.screenshot({
  path: '/tmp/wide-image.png',
  clip: {
    x: imageA.x - 80,
    y: imageA.y - 5,
    width: 200,
    height: 50,
  },
});

await browser.close();
console.log('OK');
