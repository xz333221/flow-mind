import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Take a tight crop of the right side
await page.screenshot({ path: '/tmp/before-full.png', fullPage: true });
// Also crop near the code/table area
const codeBox = await page.locator('[data-node-id="r_code"]').boundingBox();
const tableBox = await page.locator('[data-node-id="r_table"]').boundingBox();
const imageBox = await page.locator('[data-node-id="r_image"]').boundingBox();
console.log('boxes:', {codeBox, tableBox, imageBox});

await page.screenshot({
  path: '/tmp/before-code.png',
  clip: {
    x: Math.max(0, codeBox.x - 80),
    y: Math.max(0, codeBox.y - 50),
    width: codeBox.width + 350,
    height: codeBox.height + 200,
  },
});
await page.screenshot({
  path: '/tmp/before-image.png',
  clip: {
    x: Math.max(0, imageBox.x - 80),
    y: Math.max(0, imageBox.y - 100),
    width: imageBox.width + 350,
    height: imageBox.height + 250,
  },
});

await browser.close();
console.log('OK');
