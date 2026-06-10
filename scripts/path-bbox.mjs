import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 2400, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Use page.evaluate to find the actual SVG path bbox and DOM box bbox in screen pixels
const result = await page.evaluate(() => {
  const svg = document.querySelector('svg.zm-svg');
  const paths = svg.querySelectorAll('path');
  const out = [];
  paths.forEach((p, i) => {
    const d = p.getAttribute('d');
    if (!d || d.length < 200) return;
    const bbox = p.getBBox();
    // BBox is in SVG coords. Get path's screen bbox
    const screenBBox = p.getBoundingClientRect();
    out.push({
      i,
      fill: p.getAttribute('fill'),
      svgBBox: {x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height},
      screenBBox: {x: screenBBox.x, y: screenBBox.y, w: screenBBox.width, h: screenBBox.height},
    });
  });
  return out;
});
console.log(JSON.stringify(result, null, 2));

await browser.close();
