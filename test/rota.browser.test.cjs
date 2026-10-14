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

test('generated delivery assignments can be edited without regenerating the rota',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(__dirname,'..','index.html')).href);
  await page.locator('#startDate').fill('2026-10-19');
  await page.locator('#startDate').dispatchEvent('change');
  await page.locator('#numDays').fill('9');
  await page.locator('#numDays').dispatchEvent('change');
  const counts=[0,9,0,0,0,9,9,0,0,0];
  for (let p=0;p<counts.length;p++) await page.locator('#cnt'+p).fill(String(counts[p]));
  for (const d of [1,8]) await page.locator(`#delivWrap .pick[data-d="${d}"][data-p="0"]`).click();
  await page.locator('#offGridWrap .seg[data-p="8"][data-d="1"][data-s="all"]').click();
  await page.locator('#btnGen').click();
  const deliveryButton=d=>page.locator(`.delivery-button[data-d="${d}"]`);
  const state=()=>page.evaluate(()=>({
    grid:currentRota?.grid,
    deliveries:currentRota ? [...currentRota.deliveries].map(([d,who])=>[d,[...who]]).sort((a,b)=>a[0]-b[0]) : null,
    settings:[...delivery].map(([d,who])=>[d,[...who]]),
    history:currentRota?.history.length,
    warnings:document.getElementById('warningList').textContent,
  }));
  const selectPeople=async people=>{
    for (let p=0;p<counts.length;p++)
      await page.locator(`#deliveryOptions input[value="${p}"]`).setChecked(people.includes(p));
  };
  const saveDelivery=async()=>{
    await page.locator('#btnSaveDelivery').click();
    await page.waitForFunction(()=>editingDeliveryDay===null);
  };
  const assign=async(day,people)=>{
    await deliveryButton(day).click();
    await selectPeople(people);
    await saveDelivery();
  };
  const baseline=await state();
  assert.equal(await page.locator('.delivery-button').count(),2,'Only Tuesdays have delivery controls');
  assert.equal(await page.locator('#rotaWarnings').isVisible(),false);

  await t.test('delivery names and hours update while shifts and step 3 stay unchanged',async()=>{
    await deliveryButton(1).click();
    assert.equal(await page.locator('#btnSaveDelivery').isDisabled(),true);
    assert.equal(await page.locator('#deliveryOptions input:checked').inputValue(),'0');
    await selectPeople([9]);
    assert.equal(await page.locator('.shift-button').count(),27,'The delivery editor must not invalidate the rota');
    await saveDelivery();
    const actual=await state();
    assert.deepEqual(actual.grid,baseline.grid);
    assert.deepEqual(actual.deliveries,[[1,[9]],[8,[0]]]);
    assert.deepEqual(actual.settings,baseline.settings);
    assert.equal(actual.history,1);
    assert.equal(await deliveryButton(1).evaluate(el=>el===document.activeElement),true);
    assert.match(await deliveryButton(1).textContent(),/RIDA BILAL/);
    assert.match(await page.locator('.tile').filter({hasText:'RIDA BILAL'}).textContent(),/0 shifts \+ 1 delivery.*4.0 hours/);
    assert.match(await page.locator('.tile').filter({hasText:'HASSAN'}).textContent(),/0 shifts \+ 1 delivery.*4.0 hours/);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await page.locator('#btnResetEdits').isDisabled(),false);
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).deliveries,baseline.deliveries);
    assert.equal(await page.locator('#btnUndo').isDisabled(),true);
    assert.equal(await page.locator('#btnResetEdits').isDisabled(),true);
  });

  await t.test('multiple delivery people each receive four hours and mixed edits undo in order',async()=>{
    await assign(1,[3,9]);
    assert.match(await deliveryButton(1).textContent(),/RIDA FATIMA & RIDA BILAL/);
    for (const name of ['RIDA FATIMA','RIDA BILAL'])
      assert.match(await page.locator('.tile').filter({hasText:name}).textContent(),/1 delivery.*4.0 hours/);
    const deliveries=(await state()).deliveries;
    await page.locator('.shift-button[data-d="0"][data-s="2"]').click();
    await page.locator('#editPerson').selectOption('0');
    assert.doesNotMatch(await page.locator('#editPreview').textContent(),/runs into their day off or delivery/);
    await page.locator('#btnSaveEdit').click();
    await page.waitForFunction(()=>editingSlot===null);
    assert.equal((await state()).grid[0][2],0);
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).grid,baseline.grid);
    assert.deepEqual((await state()).deliveries,deliveries);
    await page.locator('#btnUndo').click();
    assert.deepEqual((await state()).deliveries,baseline.deliveries);
  });

  await t.test('delivery conflicts preview and save, then disappear when corrected',async()=>{
    await deliveryButton(1).click();
    await selectPeople([5]);
    const preview=await page.locator('#deliveryPreview').textContent();
    assert.match(preview,/runs into their day off or delivery/);
    assert.match(preview,/conflicts with their delivery that day/);
    await saveDelivery();
    assert.equal(await deliveryButton(1).locator('.warning-badge').isVisible(),true);
    assert.match(await page.locator('.tile').filter({hasText:'JERRY'}).textContent(),/9 shifts \+ 1 delivery.*76.0 hours/);
    assert.equal(await page.locator('.shift-button[data-d="0"][data-s="2"] .warning-badge').isVisible(),true);
    await assign(1,[9]);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await deliveryButton(1).locator('.warning-badge').count(),0);
    assert.equal(await page.locator('.shift-button .warning-badge').count(),0);
  });

  await t.test('delivery on a whole day off is flagged without blocking the edit',async()=>{
    await assign(1,[8]);
    assert.match((await state()).warnings,/Zaheer's delivery.*whole day off/);
    assert.equal(await deliveryButton(1).locator('.warning-badge').isVisible(),true);
    await page.locator('#btnUndo').click();
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
  });

  await t.test('an empty delivery remains editable and has no picker text in the printout',async()=>{
    await assign(1,[]);
    assert.match((await state()).warnings,/No one is assigned to the delivery/);
    assert.equal(await deliveryButton(1).locator('.delivery-placeholder').isVisible(),true);
    assert.equal(await deliveryButton(1).locator('..').locator('xpath=following-sibling::td[1]').textContent(),'');
    await page.emulateMedia({media:'print'});
    assert.equal(await deliveryButton(1).locator('.delivery-placeholder').isVisible(),false);
    await page.emulateMedia({media:'screen'});
    await assign(1,[9]);
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
  });

  await t.test('Escape and Cancel discard checkbox changes and restore keyboard focus',async()=>{
    const before=await state();
    await deliveryButton(1).focus();
    await page.keyboard.press('Enter');
    await selectPeople([3]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>editingDeliveryDay===null);
    assert.deepEqual(await state(),before);
    assert.equal(await deliveryButton(1).evaluate(el=>el===document.activeElement),true);
    await deliveryButton(1).click();
    await selectPeople([0]);
    await page.locator('#btnCancelDelivery').click();
    await page.waitForFunction(()=>editingDeliveryDay===null);
    assert.deepEqual(await state(),before);
  });

  await t.test('reset restores all original delivery people and can itself be undone',async()=>{
    const before=await state();
    await page.locator('#btnResetEdits').click();
    assert.deepEqual((await state()).deliveries,baseline.deliveries);
    assert.deepEqual((await state()).grid,baseline.grid);
    await page.locator('#btnUndo').click();
    assert.deepEqual(await state(),before);
  });

  await t.test('delivery names print without Edited or Review markers',async()=>{
    await assign(1,[5]);
    assert.equal(await deliveryButton(1).locator('.edited-badge').isVisible(),true);
    assert.equal(await deliveryButton(1).locator('.warning-badge').isVisible(),true);
    await page.emulateMedia({media:'print'});
    assert.equal(await deliveryButton(1).innerText(),'JERRY');
    assert.equal(await page.locator('#rotaWarnings').isVisible(),false);
    assert.equal(await page.locator('.fixed-badge, .edited-badge, .warning-badge').evaluateAll(els=>els.every(el=>getComputedStyle(el).display==='none')),true);
    await page.emulateMedia({media:'screen'});
  });

  await t.test('delivery picker works by touch on a phone',async()=>{
    await page.setViewportSize({width:390,height:844});
    await deliveryButton(1).tap();
    await page.locator('#deliveryOptions input[value="5"]').tap();
    await page.locator('#deliveryOptions input[value="9"]').tap();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.locator('#btnSaveDelivery').tap();
    await page.waitForFunction(()=>editingDeliveryDay===null);
    assert.deepEqual((await state()).deliveries,[[1,[9]],[8,[0]]]);
  });

  await t.test('generation uses step 3 again and input changes clear the edited rota',async()=>{
    await page.locator('#btnShuffle').click();
    assert.deepEqual((await state()).deliveries,baseline.deliveries);
    assert.equal((await state()).history,0);
    await page.locator('#delivWrap .pick[data-d="1"][data-p="9"]').click();
    assert.equal(await page.locator('.delivery-button').count(),0);
    assert.equal(await page.evaluate(()=>currentRota),null);
  });
  assert.deepEqual(errors,[],'No browser exceptions');
});
