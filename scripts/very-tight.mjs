import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Find the line tip for code→code_a and capture a very tight area
const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const code = await page.locator('[data-node-id="r_code"]').boundingBox();
console.log('code:', code);
console.log('code_a:', codeA);

// Very tight crop just at the line tip entering the box
await page.screenshot({
  path: '/tmp/very-tight-code.png',
  clip: {
    x: codeA.x - 8,
    y: codeA.y + codeA.height/2 - 8,
    width: 16,
    height: 16,
  },
});

// Also for image→image_a
const imageA = await page.locator('[data-node-id="r_image_a"]').boundingBox();
const image = await page.locator('[data-node-id="r_image"]').boundingBox();
await page.screenshot({
  path: '/tmp/very-tight-image.png',
  clip: {
    x: imageA.x - 8,
    y: imageA.y + imageA.height/2 - 8,
    width: 16,
    height: 16,
  },
});

await browser.close();
console.log('OK');
