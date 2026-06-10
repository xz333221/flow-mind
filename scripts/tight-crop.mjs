import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2000, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Crop very tightly around the line tip for code→code_a
const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const code = await page.locator('[data-node-id="r_code"]').boundingBox();
console.log('code:', code);
console.log('code_a:', codeA);

await page.screenshot({
  path: '/tmp/tight-code-line.png',
  clip: {
    x: codeA.x - 15,
    y: codeA.y - 15,
    width: 30 + codeA.width,
    height: 30 + codeA.height,
  },
});

const imageA = await page.locator('[data-node-id="r_image_a"]').boundingBox();
const image = await page.locator('[data-node-id="r_image"]').boundingBox();
await page.screenshot({
  path: '/tmp/tight-image-line.png',
  clip: {
    x: imageA.x - 15,
    y: imageA.y - 15,
    width: 30 + imageA.width,
    height: 30 + imageA.height,
  },
});

await browser.close();
console.log('OK');
