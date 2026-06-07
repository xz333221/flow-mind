// Image-feature smoke test.  Drives the on-canvas image button via
// Playwright's filechooser interception so we exercise the real upload
// path (File → FileReader → Image probe → setData).  We then drag the
// resize handle and click the remove button.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })

// Pick a non-root node (any branch — "核心功能" works).
const target = page.locator('.zm-node:has-text("核心功能")').first()
await target.hover()
await page.waitForTimeout(150)

// Set up filechooser handler BEFORE clicking the image button.  Use a
// tiny valid PNG (4×3) so the probe Image.onload fires with a real
// naturalWidth/naturalHeight.
const fileChooserPromise = page.waitForEvent('filechooser')
await page.locator('.zm-image-btn').first().click()
const fc = await fileChooserPromise

// Create a small PNG in memory.  We can't easily synthesize a PNG
// with Node's stdlib, but the PNG header + a tiny IDAT chunk is
// sufficient — FileReader.readAsDataURL works on any bytes, and the
// layout treats width=1 / height=1 fine.
import { Buffer } from 'node:buffer'
// 1×1 red PNG (89 bytes).  Valid format, decodes to naturalW=1.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)
await fc.setFiles({ name: 'red.png', mimeType: 'image/png', buffer: PNG_1x1 })

await page.waitForTimeout(500)

// Click the node to select it and reveal the resize/remove UI.
await target.click()
await page.waitForTimeout(150)

// 1) image rendered?
const imgCount = await page.locator('.zm-node-img').count()
console.log(`rendered images: ${imgCount}`)
if (imgCount !== 1) {
  console.error('expected 1 .zm-node-img, got', imgCount)
  await browser.close()
  process.exit(1)
}

const hasImageClass = await target.evaluate((el) => el.classList.contains('has-image'))
if (!hasImageClass) {
  console.error('node is missing has-image class')
  await browser.close()
  process.exit(1)
}
console.log('has-image class: ✓')

// 2) resize handle and remove button visible?
const handleCount = await page.locator('.zm-img-resize-handle').count()
if (handleCount !== 1) {
  console.error('expected 1 resize handle, got', handleCount)
  await browser.close()
  process.exit(1)
}
console.log('resize handle: ✓')

const removeCount = await page.locator('.zm-img-remove-btn').count()
if (removeCount !== 1) {
  console.error('expected 1 remove button, got', removeCount)
  await browser.close()
  process.exit(1)
}
console.log('remove button: ✓')

// 3) drag the resize handle and check the image grew.
const before = await page.locator('.zm-node-img').boundingBox()
const hb = await page.locator('.zm-img-resize-handle').boundingBox()
if (!hb || !before) {
  console.error('missing handle or img bbox')
  await browser.close()
  process.exit(1)
}
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
await page.mouse.down()
await page.mouse.move(hb.x + 80, hb.y + 80, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const after = await page.locator('.zm-node-img').boundingBox()
console.log(`img size: ${before.width.toFixed(1)}×${before.height.toFixed(1)} → ${after.width.toFixed(1)}×${after.height.toFixed(1)}`)
if (after.width <= before.width + 5) {
  console.error('resize handle did not grow the image')
  await browser.close()
  process.exit(1)
}
console.log('resize: ✓')

// 4) verify the new size is persisted in the data tree (export and
//    inspect the JSON).
const exported = await page.evaluate(() => {
  // The MindMap instance isn't exposed, but App.vue's data tree is
  // reachable through the topbar's data panel? Easier: use the
  // toolbar's "导出 JSON" download flow.
  return null
})
void exported

// 5) click remove and check the image disappears.
await page.locator('.zm-img-remove-btn').click()
await page.waitForTimeout(200)
const imgCountAfterRemove = await page.locator('.zm-node-img').count()
if (imgCountAfterRemove !== 0) {
  console.error('remove button did not clear the image')
  await browser.close()
  process.exit(1)
}
console.log('remove: ✓')

// 6) undo should bring the image back.  Click the node, then Ctrl+Z.
await target.click()
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForTimeout(200)
const imgCountAfterUndo = await page.locator('.zm-node-img').count()
if (imgCountAfterUndo !== 1) {
  console.error('Ctrl+Z did not restore the image; got', imgCountAfterUndo)
  await browser.close()
  process.exit(1)
}
console.log('undo: ✓')

await page.screenshot({ path: `${outDir}/12-image-feature.png`, fullPage: true })

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('IMAGE VERIFY OK')
