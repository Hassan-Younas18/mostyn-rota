const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/initUI\(\);\s*$/, '');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return vm.runInContext('({EMPLOYEES, M, A, N, solve, generate, validate, validateFixed, effectiveBlocks, blocked, delivery, fixed, fixedGrid, dateKey, dayDate, shiftTimes, editGrid, rotaWarnings, editDelivery, copyDeliveries, sameDeliveries})', context);
}

function setup(days=14, start='2026-10-19'){
  const app = loadApp();
  const people = Object.fromEntries(app.EMPLOYEES.map((e,p)=>[e.name,p]));
  const date = new Date(start+'T00:00:00');
  for (let d=0; d<days; d++) if (app.dayDate(date,d).getDay()===2) app.delivery.set(d,new Set([people.HASSAN]));
  return {app, people, days, date, counts:Array.from(app.EMPLOYEES,e=>e.def), locks:Array.from({length:days},()=>[-1,-1,-1])};
}

function verify(f, grid){
  assert.ok(grid, 'A valid completion should exist');
  const {app,days,counts,locks,date}=f;
  const blocks=app.effectiveBlocks(days,date), totals=counts.map(()=>0);
  assert.equal(grid.length,days);
  for(let d=0;d<days;d++){
    assert.equal(new Set(grid[d]).size,3,'One shift per person per day');
    for(let s=0;s<3;s++){
      const p=grid[d][s], person=app.EMPLOYEES[p];
      assert.ok(person.allowed.includes(s),'Allowed shift types');
      assert.ok(!blocks[p].get(d)?.has(s),'Time off, non-working weekdays and deliveries');
      if(locks[d][s]>=0) assert.equal(p,locks[d][s],'Fixed assignments must stay in place');
      if(d>0){
        const previous=grid[d-1].indexOf(p);
        assert.ok(previous===-1 || s>=previous,'Rest from the previous shift');
      }
      if(s===2 && d+1<days) assert.ok(!person.allowed.every(next=>blocks[p].get(d+1)?.has(next)),'Night must not run into a day off');
      totals[p]++;
    }
  }
  assert.deepEqual(totals,counts,'Fixed shifts are included in exact shift totals');
}

function solve(f,seed=42){
  return f.app.solve(f.days,f.counts,f.app.effectiveBlocks(f.days,f.date),seed,{},f.locks);
}

test('normal fortnight rotas remain valid without fixed shifts',()=>{
  const f=setup();
  const blocks=f.app.effectiveBlocks(f.days,f.date);
  for(let seed=1;seed<=10;seed++){
    const stat={capped:false};
    const grid=f.app.solve(f.days,f.counts,blocks,seed*7919,stat,f.locks);
    if(grid) verify(f,grid);
    else {
      // A single attempt can hit its budget; the app retries through generate().
      assert.equal(stat.capped,true,'A failed attempt must not report a valid rota as impossible');
      verify(f,f.app.generate(f.days,f.counts,blocks,f.locks));
    }
  }
});

test('Jerry can be fixed to an afternoon and then a night',()=>{
  const f=setup(2,'2026-10-21'), {HASSAN,ELAINE,JERRY,WES}=f.people;
  f.counts.fill(0);
  f.counts[ELAINE]=f.counts[JERRY]=2;
  f.counts[HASSAN]=f.counts[WES]=1;
  f.locks[0][1]=f.locks[1][2]=JERRY;
  verify(f,solve(f));
});

test('the last fixed shift reserves a person’s count until that date',()=>{
  const f=setup(3,'2026-10-21'), {HASSAN,ELAINE,JERRY,WES}=f.people;
  f.counts.fill(0);
  f.counts[HASSAN]=f.counts[ELAINE]=3;
  f.counts[WES]=2;
  f.counts[JERRY]=1;
  f.locks[2][1]=JERRY;
  verify(f,solve(f));
});

for(const which of ['before','after']) test(`automatic assignments respect rest ${which} a fixed shift`,()=>{
  const f=setup(2,'2026-10-21'), {HASSAN,ELAINE,JERRY}=f.people;
  f.counts.fill(0);
  f.counts[HASSAN]=f.counts[ELAINE]=f.counts[JERRY]=2;
  if(which==='before') f.locks[1][1]=JERRY;
  else f.locks[0][2]=JERRY;
  const grid=solve(f);
  verify(f,grid);
  assert.equal(grid[which==='before'?0:1][which==='before'?1:2],JERRY);
});

test('repeated generation preserves multiple locks and varies the remaining rota',()=>{
  const f=setup(), baseline=solve(f), results=new Set();
  for(const [d,s] of [[0,1],[4,0],[8,2],[13,2]]) f.locks[d][s]=baseline[d][s];
  for(let seed=1;seed<=12;seed++){
    const grid=solve(f,seed*7919);
    verify(f,grid);
    results.add(JSON.stringify(grid));
  }
  assert.ok(results.size>1,'Unfixed slots can change between generations');
  verify(f,f.app.generate(f.days,f.counts,f.app.effectiveBlocks(f.days,f.date),f.locks));
});

test('a fully fixed valid rota is reproduced exactly',()=>{
  const f=setup(), baseline=solve(f);
  f.locks=Array.from(baseline,row=>Array.from(row));
  const grid=solve(f,9876);
  verify(f,grid);
  assert.equal(JSON.stringify(grid),JSON.stringify(baseline));
});

const conflicts=[
  ['disallowed shift',f=>{f.locks[0][0]=f.people.JERRY;},/not an allowed shift/],
  ['two shifts on one day',f=>{f.locks[0][1]=f.locks[0][2]=f.people.JERRY;},/more than one fixed shift/],
  ['too many fixed shifts',f=>{f.counts[f.people.JERRY]=0;f.locks[0][1]=f.people.JERRY;},/only 0 total shifts/],
  ['time off',f=>{f.locks[0][1]=f.people.JERRY;f.app.blocked[f.people.JERRY].set(0,new Set([1]));},/conflicts with time off/],
  ['non-working weekday',f=>{f.locks[6][0]=f.people['RIDA FATIMA'];},/non-working weekday/],
  ['delivery day',f=>{f.locks[1][1]=f.people.HASSAN;},/delivery/],
  ['night before delivery',f=>{f.locks[0][2]=f.people.HASSAN;},/runs into their day off or delivery/],
  ['night before whole day off',f=>{f.locks[0][2]=f.people.JERRY;f.app.blocked[f.people.JERRY].set(1,new Set([1,2]));},/runs into their day off/],
  ['fixed shift rest conflict',f=>{f.locks[0][2]=f.locks[1][1]=f.people.JERRY;},/too early/],
];
for(const [name,change,message] of conflicts) test(`rejects ${name} without overriding a fixed shift`,()=>{
  const f=setup();change(f);
  const errors=f.app.validate(f.days,f.counts,f.app.effectiveBlocks(f.days,f.date),f.date,f.locks);
  assert.match(errors.join('\n'),message);
  assert.equal(solve(f),null);
});

test('fixed assignments stay on calendar dates when the start changes',()=>{
  const f=setup();
  f.app.fixed.set('2026-10-23',new Map([[1,f.people.JERRY]]));
  assert.equal(f.app.fixedGrid(14,f.date)[4][1],f.people.JERRY);
  assert.equal(f.app.fixedGrid(14,new Date('2026-10-20T00:00:00'))[3][1],f.people.JERRY);
});

test('a single day can mix fixed and automatic assignments',()=>{
  const f=setup(1,'2026-10-21');
  f.counts.fill(0);
  for(const name of ['HASSAN','ELAINE','JERRY']) f.counts[f.people[name]]=1;
  f.locks[0][1]=f.people.JERRY;
  verify(f,solve(f));
});

test('28 days supports fixed assignments at both ends of the range',()=>{
  const f=setup(28);
  f.counts.fill(0);
  for(const name of ['HASSAN','JERRY','USAMA']) f.counts[f.people[name]]=28;
  for(const d of f.app.delivery.keys()) f.app.delivery.set(d,new Set([f.people.ZAHEER]));
  f.locks[0][0]=f.people.HASSAN;
  f.locks[27][2]=f.people.USAMA;
  verify(f,solve(f));
});

test('fixing Arooj preserves the 21:30 night handover',()=>{
  const f=setup(1,'2026-10-21');
  f.counts.fill(0);
  for(const name of ['HASSAN','ELAINE','AROOJ']) f.counts[f.people[name]]=1;
  f.locks[0][1]=f.people.AROOJ;
  const grid=solve(f);verify(f,grid);
  const times=f.app.shiftTimes(grid,0);
  assert.equal(times.afternoon.to,'21:30');
  assert.equal(times.afternoon.hrs,7.5);
  assert.equal(times.night.from,'21:30');
  assert.equal(times.night.hrs,8.5);
});

function review(f,grid){
  return f.app.rotaWarnings(grid,f.counts,f.app.effectiveBlocks(f.days,f.date),f.date,f.locks);
}

test('generated rotas have no manual-edit warnings',()=>{
  const f=setup(), grid=solve(f);
  assert.equal(review(f,grid).length,0);
});

test('reassignment allows a new person, reports both target differences and leaves the original untouched',()=>{
  const f=setup(), grid=solve(f), original=JSON.stringify(grid);
  const previous=grid[2][0], replacement=f.people.ZAHEER;
  const next=f.app.editGrid(grid,[2,0],{person:replacement});
  assert.equal(next[2][0],replacement);
  assert.equal(JSON.stringify(grid),original);
  const warnings=review(f,next).map(w=>w.message).join('\n');
  assert.match(warnings,/Zaheer now has 1 shift; their target in step 2 is 0/);
  assert.ok(warnings.toLowerCase().includes(f.app.EMPLOYEES[previous].name.toLowerCase()+' now has'));
});

test('swapping shifts changes both destinations atomically and preserves counts',()=>{
  const f=setup(), grid=solve(f), original=JSON.stringify(grid);
  const morning=grid.findIndex(row=>f.app.EMPLOYEES[row[0]].allowed.length===1);
  const night=(morning+1)%f.days;
  const next=f.app.editGrid(grid,[morning,0],{swap:[night,2]});
  assert.equal(next[morning][0],grid[night][2]);
  assert.equal(next[night][2],grid[morning][0]);
  assert.equal(JSON.stringify(grid),original);
  assert.ok(!review(f,next).some(w=>w.message.includes('target in step 2')));
  assert.ok(review(f,next).some(w=>w.message.includes('not an allowed shift')));
});

test('invalid edit coordinates and people do not change the rota',()=>{
  const f=setup(), grid=solve(f), original=JSON.stringify(grid);
  for (const slot of [[-1,0],[14,0],[0,3],[0.5,0],null])
    assert.equal(f.app.editGrid(grid,slot,{person:0}),null);
  for (const person of [-1,10,0.5,NaN])
    assert.equal(f.app.editGrid(grid,[0,0],{person}),null);
  assert.equal(f.app.editGrid(grid,[0,0],{swap:[14,0]}),null);
  assert.equal(JSON.stringify(grid),original);
});

test('dropping on the same shift is a no-op',()=>{
  const f=setup(), grid=solve(f);
  assert.equal(JSON.stringify(f.app.editGrid(grid,[0,0],{swap:[0,0]})),JSON.stringify(grid));
});

const manualConflicts=[
  ['allowed shift',f=>[0,0,f.people.JERRY],/not an allowed shift/],
  ['time off',f=>{f.app.blocked[f.people.ZAHEER].set(3,new Set([1]));return [3,1,f.people.ZAHEER];},/conflicts with time off/],
  ['non-working weekday',f=>[6,0,f.people['RIDA FATIMA']],/non-working weekday/],
  ['delivery',f=>[1,1,f.people.HASSAN],/conflicts with time off, a non-working weekday or a delivery/],
  ['overnight delivery',f=>[0,2,f.people.HASSAN],/runs into their day off or delivery/],
  ['overnight time off',f=>{f.app.blocked[f.people.ZAHEER].set(3,new Set([0,1,2]));return [2,2,f.people.ZAHEER];},/runs into their day off/],
];
for (const [name,change,pattern] of manualConflicts) test(`manual edits allow but warn about ${name} conflicts`,()=>{
  const f=setup(), grid=solve(f), [d,s,p]=change(f);
  const next=f.app.editGrid(grid,[d,s],{person:p});
  assert.equal(next[d][s],p,'Manual changes must be allowed');
  assert.match(review(f,next).map(w=>w.message).join('\n'),pattern);
});

test('manual edits warn about multiple shifts on the same day',()=>{
  const f=setup(), grid=solve(f);
  const next=f.app.editGrid(grid,[2,0],{person:grid[2][1]});
  const warning=review(f,next).find(w=>w.message.includes('2 shifts on'));
  assert.ok(warning);
  assert.equal(JSON.stringify(warning.slots),JSON.stringify([[2,0],[2,1]]));
});

test('rest warnings cover both neighbouring days and highlight both shifts',()=>{
  const f=setup(), grid=solve(f), p=f.people.ZAHEER;
  let next=f.app.editGrid(grid,[2,2],{person:p});
  next=f.app.editGrid(next,[3,1],{person:p});
  next=f.app.editGrid(next,[4,0],{person:p});
  const warnings=review(f,next).filter(w=>w.message.includes('too early'));
  assert.equal(warnings.length,2);
  assert.equal(JSON.stringify(warnings[0].slots),JSON.stringify([[2,2],[3,1]]));
  assert.equal(JSON.stringify(warnings[1].slots),JSON.stringify([[3,1],[4,0]]));
});

test('overriding a fixed shift warns without altering generation settings',()=>{
  const f=setup(), grid=solve(f);
  f.locks[2][0]=grid[2][0];
  const next=f.app.editGrid(grid,[2,0],{person:f.people.ZAHEER});
  assert.ok(review(f,next).some(w=>w.message.includes('was fixed to')));
  assert.equal(f.locks[2][0],grid[2][0]);
  assert.ok(!review(f,grid).some(w=>w.message.includes('was fixed to')));
});

test('moving Arooj updates handover hours at both ends of the swap',()=>{
  const f=setup(), grid=solve(f);
  const aroojDay=grid.findIndex(row=>row[1]===f.people.AROOJ);
  const otherDay=grid.findIndex(row=>row[1]!==f.people.AROOJ);
  const next=f.app.editGrid(grid,[aroojDay,1],{swap:[otherDay,1]});
  assert.equal(f.app.shiftTimes(next,aroojDay).afternoon.hrs,8);
  assert.equal(f.app.shiftTimes(next,aroojDay).night.from,'22:00');
  assert.equal(f.app.shiftTimes(next,otherDay).afternoon.hrs,7.5);
  assert.equal(f.app.shiftTimes(next,otherDay).night.from,'21:30');
  assert.equal(f.app.shiftTimes(next,otherDay).night.hrs,8.5);
});

for (const days of [1,28]) test(`editing the final shift of a ${days}-day rota is supported`,()=>{
  const f=setup(days,'2026-10-21');
  const grid=Array.from({length:days},()=>[f.people.ELAINE,f.people.WES,f.people.JERRY]);
  const next=f.app.editGrid(grid,[days-1,2],{person:f.people.ZAHEER});
  assert.equal(next[days-1][2],f.people.ZAHEER);
  assert.ok(review(f,next).length>0);
});

test('delivery edits support multiple people without mutating settings or other Tuesdays',()=>{
  const f=setup(), {app,people}=f;
  const next=app.editDelivery(app.delivery,1,[people['RIDA FATIMA'],people['RIDA BILAL'],people['RIDA FATIMA']],f.days,f.date);
  assert.deepEqual([...next.get(1)],[people['RIDA FATIMA'],people['RIDA BILAL']]);
  assert.deepEqual([...app.delivery.get(1)],[people.HASSAN]);
  assert.deepEqual([...next.get(8)],[people.HASSAN]);
  assert.notEqual(next.get(8),app.delivery.get(8),'Snapshots must not share mutable sets');
  const reordered=app.editDelivery(next,1,[people['RIDA BILAL'],people['RIDA FATIMA']],f.days,f.date);
  assert.equal(app.sameDeliveries(next,reordered),true,'Checkbox order does not create a new edit');
  const empty=app.editDelivery(next,1,[],f.days,f.date);
  assert.equal(empty.has(1),false);
  assert.equal(next.get(1).size,2);
});

test('delivery edits reject invalid dates and people',()=>{
  const f=setup(), {app}=f;
  for (const day of [-1,0,2,14,1.5,NaN])
    assert.equal(app.editDelivery(app.delivery,day,[0],f.days,f.date),null);
  for (const people of [[-1],[10],[0.5],[NaN],null])
    assert.equal(app.editDelivery(app.delivery,1,people,f.days,f.date),null);
});

test('delivery edits support the first and final days of the supported range',()=>{
  const f=setup(1,'2026-10-20');
  assert.deepEqual([...f.app.editDelivery(f.app.delivery,0,[8],1,f.date).get(0)],[8]);
  const start=new Date('2026-10-21T00:00:00');
  assert.deepEqual([...f.app.editDelivery(new Map(),27,[8],28,start).get(27)],[8]);
});

function deliveryReview(f,grid,assignments){
  return f.app.rotaWarnings(grid,f.counts,f.app.effectiveBlocks(f.days,f.date,assignments),f.date,f.locks,{
    assignments,availability:f.app.effectiveBlocks(f.days,f.date,new Map())
  });
}

test('changing delivery people removes the old blocks and adds current conflicts',()=>{
  const f=setup(2), {app,people}=f;
  const grid=[[people.ELAINE,people.WES,people.JERRY],[people.ELAINE,people.WES,people.JERRY]];
  f.counts.fill(0);
  for (const p of [people.ELAINE,people.WES,people.JERRY]) f.counts[p]=2;
  assert.equal(deliveryReview(f,grid,app.delivery).length,0);
  const next=app.editDelivery(app.delivery,1,[people.JERRY],f.days,f.date);
  const blocks=app.effectiveBlocks(f.days,f.date,next);
  assert.equal(blocks[people.HASSAN].has(1),false,'The former delivery person is available again');
  assert.equal(blocks[people.JERRY].get(1).has(app.N),true);
  const warnings=deliveryReview(f,grid,next);
  assert.equal(warnings.length,2,'Regular shift and previous night are the two conflicts');
  assert.ok(warnings.every(w=>w.deliveryDays.includes(1)));
  assert.ok(warnings.some(w=>w.slots.some(([d,s])=>d===0 && s===app.N)));
  assert.ok(warnings.some(w=>w.slots.some(([d,s])=>d===1 && s===app.N)));
  assert.equal(deliveryReview(f,grid,app.delivery).length,0,'Restoring the original delivery clears the warnings');
});

test('delivery edits warn about a whole day off and an unassigned Tuesday',()=>{
  const f=setup(), {app,people}=f, grid=solve(f);
  app.blocked[people.ZAHEER].set(1,new Set([app.M,app.A,app.N]));
  const next=app.editDelivery(app.delivery,1,[people.ZAHEER],f.days,f.date);
  const unavailable=deliveryReview(f,grid,next).find(w=>w.message.includes("Zaheer's delivery"));
  assert.match(unavailable.message,/whole day off/);
  assert.deepEqual([...unavailable.deliveryDays],[1]);
  const empty=app.editDelivery(next,1,[],f.days,f.date);
  const missing=deliveryReview(f,grid,empty).find(w=>w.message.includes('No one is assigned'));
  assert.ok(missing);
  assert.deepEqual([...missing.deliveryDays],[1]);
  assert.ok(!deliveryReview(f,grid,empty).some(w=>w.message.includes('target in step 2')));
});
