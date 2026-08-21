const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1000 });
  await page.goto('http://localhost:5173');
  
  await wait(2000);
  
  // Click on Part-time tab
  const parttimeTab = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('아르바이트'));
  });
  if (parttimeTab) await parttimeTab.click();
  
  await wait(1000);
  
  // Click on the first employee name
  const empName = await page.evaluateHandle(() => {
    // find a span containing a name, for example the first one in the table
    // The names are inside spans with cursor-pointer
    return Array.from(document.querySelectorAll('span.cursor-pointer')).find(el => el.textContent.includes('김서빙') || el.textContent.includes('박포스') || el.textContent.includes('김알바'));
  });
  
  if (empName) {
    await empName.click();
    await wait(1000);
    
    // Click Edit button
    const editBtn = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('수정하기'));
    });
    if (editBtn) await editBtn.click();
    
    await wait(500);
    
    await page.screenshot({ path: 'parttime_profile_modal.png' });
    console.log("Modal screenshot saved.");
  } else {
    console.log("Could not find employee name to click.");
  }
  
  await browser.disconnect();
})();
