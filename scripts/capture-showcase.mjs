import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder = new URL('../docs/images/', import.meta.url);
await mkdir(folder, { recursive:true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport:{ width:1024, height:1500 }, reducedMotion:'reduce' });
  for (const example of ['analog','broadcast','arcade','terminal']) {
    await page.goto((process.env.DEMO_URL || 'http://127.0.0.1:8788') + '/demo/showcase.html?example=' + example);
    await page.waitForFunction(example => document.querySelector('#screen')?.dataset.ready === example, example);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#comparison').screenshot({ path:fileURLToPath(new URL(example + '-comparison.jpg', folder)), type:'jpeg', quality:94 });
    console.log(example + '-comparison.jpg');
  }
} finally { await browser.close(); }
