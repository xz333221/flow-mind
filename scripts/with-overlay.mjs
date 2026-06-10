import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Inject a script to draw a vertical line at code_a's left edge
const codeA = await page.locator('[data-node-id="r_code_a"]').boundingBox();
const imageA = await page.locator('[data-node-id="r_image_a"]').boundingBox();

await page.evaluate((boxes) => {
  // Add a debug overlay showing the box's left edge
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; pointer-events:none; z-index:9999;';
  document.body.appendChild(overlay);
  // Draw a vertical line at code_a left edge
  const line1 = document.createElement('div');
  line1.style.cssText = `position:absolute; left:${boxes.codeA.x}px; top:${boxes.codeA.y}px; width:1px; height:${boxes.codeA.height}px; background:magenta;`;
  overlay.appendChild(line1);
  // Draw a vertical line at image_a left edge
  const line2 = document.createElement('div');
  line2.style.cssText = `position:absolute; left:${boxes.imageA.x}px; top:${boxes.imageA.y}px; width:1px; height:${boxes.imageA.height}px; background:cyan;`;
  overlay.appendChild(line2);
}, {codeA, imageA});

await page.screenshot({
  path: '/tmp/with-overlay.png',
  clip: {
    x: Math.min(codeA.x, imageA.x) - 80,
    y: Math.min(codeA.y, imageA.y) - 20,
    width: Math.max(codeA.x + codeA.width, imageA.x + imageA.width) - Math.min(codeA.x, imageA.x) + 100,
    height: Math.max(codeA.y + codeA.height, imageA.y + imageA.height) - Math.min(codeA.y, imageA.y) + 50,
  },
});

await browser.close();
console.log('OK');
