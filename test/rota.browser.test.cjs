// Optional UI checks: install Playwright and Chrome, then run this file with node --test.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.ROTA_PLAYWRIGHT_MODULE || 'playwright');

test('generated rota editing works with mouse, keyboard, touch layout and print',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.locator('#startDate').fill('2026-10-21');
  await page.locator('#startDate').dispatchEvent('change');
  await page.locator('#numDays').fill('2');
  await page.locator('#numDays').dispatchEvent('change');
  const counts=[0,2,1,0,0,2,1,0,0,0];
  for (let p=0;p<counts.length;p++) await page.locator('#cnt'+p).fill(String(counts[p]));
  await page.locator('#fixedGridWrap select[data-date="2026-10-21"][data-s="1"]').selectOption('2');
  await page.locator('#btnGen').click();

  const shift=(d,s)=>page.locator(`.shift-button[data-d="${d}"][data-s="${s}"]`);
  const state=()=>page.evaluate(()=>({
    grid:currentRota?.grid, history:currentRota?.history.length,
    warnings:document.getElementById('warningList').textContent,
    dialog:document.getElementById('shiftEditor').open,
  }));
  const choose=async(d,s,p)=>{
    await shift(d,s).click();
    await page.locator('#editPerson').selectOption(String(p));
    await page.locator('#btnSaveEdit').click();
    await page.waitForFunction(()=>!document.getElementById('shiftEditor').open && editingSlot===null);
  };
  const baseline=(await state()).grid;
  assert.deepEqual(baseline,[[1,2,5],[1,6,5]]);
  assert.equal(await page.locator('.shift-button').count(),6);
  assert.equal(await page.locator('#rotaWarnings').isVisible(),false);

  await t.test('click to assign updates totals, handover, fixed warnings and focus',async()=>{
    await shift(0,1).click();
    await page.locator('#editPerson').selectOption('6');
    assert.equal(await page.locator('.shift-button').count(),6,'Changing the picker must not invalidate the rota');
    assert.match(await page.locator('#editPreview').textContent(),/target in step 2/);
    await page.locator('#btnSaveEdit').click();
    await page.waitForFunction(()=>editingSlot===null);
    const actual=await state();
    assert.deepEqual(actual.grid,[[1,6,5],[1,6,5]]);
    assert.match(actual.warnings,/was fixed to Arooj/);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),true);
    assert.equal(await shift(0,1).locator('.fixed-badge').count(),0);
    assert.equal(await shift(0,1).locator('.edited-badge').count(),1);
    assert.equal(await shift(0,1).evaluate(el=>el===document.activeElement),true);
    assert.match(await page.locator('td[data-d="0"][data-s="2"]').allTextContents().then(a=>a.join(' ')),/22:00/);
    assert.match(await page.locator('.tile').filter({hasText:'WES'}).textContent(),/2 shifts.*16.0 hours/);
    assert.match(await page.locator('.tile').filter({hasText:'JERRY'}).textContent(),/16.0 hours/);
    assert.deepEqual(await page.locator('#cnt2, #cnt6').evaluateAll(els=>els.map(el=>el.value)),['1','1']);
  });

  await t.test('undo restores the complete generated rota',async()=>{
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).grid,baseline);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await page.locator('#btnUndo').isDisabled(),true);
    assert.equal(await page.locator('#btnResetEdits').isDisabled(),true);
    assert.match(await page.locator('.tile').filter({hasText:'JERRY'}).textContent(),/16.5 hours/);
  });

  await t.test('native drag and drop swaps both shifts including their handover times',async()=>{
    await shift(0,1).dragTo(shift(1,1));
    const actual=await state();
    assert.deepEqual(actual.grid,[[1,6,5],[1,2,5]]);
    assert.equal(actual.history,1);
    assert.equal(await page.locator('.edited-badge').count(),2);
    assert.doesNotMatch(actual.warnings,/target in step 2/);
    assert.match(await page.locator('td[data-d="1"][data-s="2"]').allTextContents().then(a=>a.join(' ')),/21:30/);
    assert.equal(await page.locator('.drop-target, .is-dragging').count(),0);
  });

  await t.test('reset edits is itself undoable',async()=>{
    await page.locator('#btnResetEdits').click();
    assert.deepEqual((await state()).grid,baseline);
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).grid,[[1,6,5],[1,2,5]]);
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).grid,baseline);
  });

  await t.test('keyboard edit and Escape preserve state and return focus',async()=>{
    await shift(0,0).focus();
    await page.keyboard.press('Enter');
    assert.equal((await state()).dialog,true);
    await page.locator('#editPerson').selectOption('5');
    assert.match(await page.locator('#editPreview').textContent(),/2 shifts on/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>editingSlot===null);
    assert.deepEqual((await state()).grid,baseline);
    assert.equal(await shift(0,0).evaluate(el=>el===document.activeElement),true);
  });

  await t.test('keyboard swap offers an alternative to dragging',async()=>{
    await shift(0,1).focus();
    await page.keyboard.press('Enter');
    await page.locator('#editAction').selectOption('swap');
    assert.equal(await page.locator('#btnSaveEdit').isDisabled(),true);
    await page.locator('#editSwap').selectOption('1,1');
    await page.locator('#btnSaveEdit').click();
    await page.waitForFunction(()=>editingSlot===null);
    assert.deepEqual((await state()).grid,[[1,6,5],[1,2,5]]);
    await page.locator('#btnUndo').click();
  });

  await t.test('same-person swaps and cancelled edits do not create undo entries',async()=>{
    await shift(0,0).click();
    await page.locator('#editAction').selectOption('swap');
    await page.locator('#editSwap').selectOption('1,0');
    assert.equal(await page.locator('#btnSaveEdit').isDisabled(),true);
    await page.locator('#btnCancelEdit').click();
    await page.waitForFunction(()=>editingSlot===null);
    assert.equal((await state()).history,0);
    await shift(0,0).dragTo(shift(1,0));
    assert.equal((await state()).history,0);
  });

  await t.test('print shows a clean rota while editing labels and warnings stay on screen',async()=>{
    await choose(0,0,5);
    const actual=await state();
    assert.equal(actual.grid[0][0],5);
    assert.match(actual.warnings,/not an allowed shift/);
    assert.match(actual.warnings,/2 shifts on/);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),true);
    assert.equal(await shift(0,0).locator('.warning-badge').isVisible(),true);
    assert.equal(await shift(0,0).locator('.edited-badge').isVisible(),true);
    assert.equal(await shift(0,1).locator('.fixed-badge').isVisible(),true);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('#editHelp').isVisible(),false);
    assert.equal(await page.locator('#toolbar').isVisible(),false);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await shift(0,0).isVisible(),true);
    assert.equal(await page.locator('.fixed-badge, .edited-badge, .warning-badge').evaluateAll(els=>els.every(el=>getComputedStyle(el).display==='none')),true);
    await page.emulateMedia({media:'screen'});
    assert.equal(await page.locator('#rotaWarnings').isVisible(),true);
    assert.equal(await shift(0,0).locator('.warning-badge').isVisible(),true);
    assert.equal(await shift(0,0).locator('.edited-badge').isVisible(),true);
    assert.equal(await shift(0,1).locator('.fixed-badge').isVisible(),true);
  });

  await t.test('generate again uses the original targets and fixed assignments',async()=>{
    await page.locator('#btnShuffle').click();
    assert.deepEqual((await state()).grid,baseline);
    assert.equal((await state()).history,0);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
  });

  await t.test('phone layout supports tapping and swapping without page overflow',async()=>{
    await page.setViewportSize({width:390,height:844});
    await shift(0,1).tap();
    await page.locator('#editAction').selectOption('swap');
    await page.locator('#editSwap').selectOption('1,1');
    assert.equal(await page.locator('#btnSaveEdit').isVisible(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.locator('#btnSaveEdit').tap();
    await page.waitForFunction(()=>editingSlot===null);
    assert.deepEqual((await state()).grid,[[1,6,5],[1,2,5]]);
  });

  await t.test('changing generation inputs invalidates edited output and history',async()=>{
    await page.locator('#cnt0').fill('1');
    assert.equal(await page.locator('.shift-button').count(),0);
    assert.equal(await page.locator('#toolbar').isVisible(),false);
    assert.equal(await page.locator('#editHelp').isVisible(),false);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await page.evaluate(()=>currentRota),null);
  });
  assert.deepEqual(errors,[],'No browser exceptions');
});
