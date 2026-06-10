import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const code = await page.locator('[data-node-id="r_code"]').boundingBox();
const imageA = await page.locator('[data-node-id="r_image_a"]').boundingBox();
const image = await page.locator('[data-node-id="r_image"]').boundingBox();
const tableA = await page.locator('[data-node-id="r_table_a"]').boundingBox();

// Capture a wider area showing both parent and child, and the line between them
await page.screenshot({
  path: '/tmp/full-code-line.png',
  clip: {
    x: Math.min(code.x, codeA.x) - 30,
    y: Math.min(code.y, codeA.y) - 20,
    width: Math.max(code.x + code.width, codeA.x + codeA.width) - Math.min(code.x, codeA.x) + 60,
    height: Math.max(code.y + code.height, codeA.y + codeA.height) - Math.min(code.y, codeA.y) + 40,
  },
});

await page.screenshot({
  path: '/tmp/full-image-line.png',
  clip: {
    x: Math.min(image.x, imageA.x) - 30,
    y: Math.min(image.y, imageA.y) - 20,
    width: Math.max(image.x + image.width, imageA.x + imageA.width) - Math.min(image.x, imageA.x) + 60,
    height: Math.max(image.y + image.height, imageA.y + imageA.height) - Math.min(image.y, imageA.y) + 40,
  },
});

await browser.close();
console.log('OK');
