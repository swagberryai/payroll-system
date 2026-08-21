const puppeteer = require('puppeteer');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1000 });
  await page.goto('http://localhost:5173');
  
  await wait(2000);
  
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('급여 관리')) {
      await btn.click();
      break;
    }
  }
  
  await wait(1000);
  
  const typeButtons = await page.$$('button');
  for (const btn of typeButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text === '아르바이트') {
      await btn.click();
      break;
    }
  }
  
  await wait(1000);
  
  await page.screenshot({ path: '/Users/pro/.gemini/antigravity-ide/brain/2f5fc407-8eed-4eec-bfb8-b0e8c1cffabc/parttime_payroll_table_all.png', fullPage: true });

  const modes = await page.$$('button');
  for (const btn of modes) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('A파트')) {
      await btn.click();
      break;
    }
  }

  await wait(1000);
  await page.screenshot({ path: '/Users/pro/.gemini/antigravity-ide/brain/2f5fc407-8eed-4eec-bfb8-b0e8c1cffabc/parttime_payroll_table_partA.png', fullPage: true });

  const modes2 = await page.$$('button');
  for (const btn of modes2) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('B파트')) {
      await btn.click();
      break;
    }
  }

  await wait(1000);
  await page.screenshot({ path: '/Users/pro/.gemini/antigravity-ide/brain/2f5fc407-8eed-4eec-bfb8-b0e8c1cffabc/parttime_payroll_table_partB.png', fullPage: true });

  await browser.close();
  console.log("Screenshots saved.");
})();
