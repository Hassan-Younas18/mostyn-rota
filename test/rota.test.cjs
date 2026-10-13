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
  return vm.runInContext('({EMPLOYEES, M, A, N, solve, generate, validate, validateFixed, effectiveBlocks, blocked, delivery, fixed, fixedGrid, dateKey, dayDate, shiftTimes})', context);
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
  for(let seed=1;seed<=10;seed++) verify(f,solve(f,seed*7919));
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
  ['non-working weekday',f=>{f.locks[5][0]=f.people.ELAINE;},/non-working weekday/],
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
