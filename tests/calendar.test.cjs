const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
class TestDate extends Date { constructor(...args) { super(...(args.length?args:[2026,8,16])); } }
function setup() {
  const context=vm.createContext({window:{},Date:TestDate});
  vm.runInContext(source.slice(0,source.indexOf('// UI event bindings')),context);
  vm.runInContext(fs.readFileSync(path.join(root,'calendar-ui.js'),'utf8'),context);
  return {context,run:code=>vm.runInContext(code,context)};
}
const headers=['Month','Event','Feature','Development Team','Track','Prod Dates','Dev Dates','comment'];
const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

test('late development remains identified as development on production bars and in alerts',()=>{
  const {run,context}=setup();
  run(`state.records=normalize(${JSON.stringify([headers,
    ['October','','Overdue','Team','Track','1.10.26 - 20.10.26','1.08.26 - 14.08.26'],
    ['October','','Done','Team','Track','1.10.26 - 20.10.26','1.08.26 - 14.08.26'],
    ['October','','Prod late','Team','Track','1.10.26 - 20.10.26','1.10.26 - 14.10.26'],
    ['October','','Estimated','Team','Track','1.09.26 - 20.09.26','']
  ])});state.records[1].prodSourceStatus='green';state.records[2].prodSourceStatus='red';`);
  assert.equal(run("phaseStatusLabel(state.records[0],'prod')"),'Late dev');
  assert.equal(run("phaseStatusLabel(state.records[0],'dev')"),'Late dev');
  assert.equal(run("phaseStatusLabel(state.records[2],'prod')"),'Late production');
  assert.deepEqual(Array.from(run('lateFeatureAlerts(state.records)'),item=>[item.record.feature,Array.from(item.phases,phase=>phase.kind)]),[['Overdue',['dev']],['Prod late',['prod']],['Estimated',['dev']]]);
  const panel={querySelector:()=>({open:true})};
  context.document={querySelector:()=>panel};
  run('renderAlerts(state.records)');
  assert.equal(panel.hidden,false);
  assert.match(panel.innerHTML,/3 late features/);
  assert.match(panel.innerHTML,/Late dev · Estimated/);
  assert.match(panel.innerHTML,/<details open>/);
  assert.doesNotMatch(panel.innerHTML,/>Done \(/);
  run('renderAlerts([])');
  assert.equal(panel.hidden,true);
});

test('live descriptions preserve physical sheet rows, colors and duplicate feature alignment',()=>{
  const {run}=setup();
  const merge=run('mergeDescriptions');
  const original=[headers.slice(0,7),['October','','Feature','Team','Track','1.10 - 20.10','1.09 - 20.09'],[],['','','Feature','Team','Track','1.10 - 20.10','1.09 - 20.09'],[],['','','Feature','Team','Track','1.10 - 20.10','1.09 - 20.09']];
  const csv=[headers,[...original[1],'First description'],[...original[3],'Second description'],[...original[5],'Third description']];
  const merged=merge(original,csv);
  assert.equal(merged.length,6);
  assert.equal(merged[1][7],'First description');
  assert.equal(merged[3][7],'Second description');
  assert.equal(merged[5][7],'Third description');
  assert.equal(merged[2].length,0);
  assert.equal(original[0].length,7);
  const normalize=run('rows=>normalize(rows)');
  assert.deepEqual(Array.from(normalize(merged),record=>record.sheetRow),[2,4,6]);
  csv[2][3]='Changed team';
  assert.throws(()=>merge(original,csv),/Sheet changed between reads/);
});

test('Track insertion maps dates, colors and descriptions by header, including reordered columns',()=>{
  const {run}=setup();
  const read=run(`(rows,backgrounds)=>{state.cellStatuses=statusesFromBackgrounds(backgrounds,rows[0]);return normalize(rows)[0];}`);
  const record=read([headers,['October','Holiday','Feature','Team','Track 1','1.10.26 - 20.10.26','1.09.26 - 20.09.26','Full description']], [[],['','','','','#ff0000','#ffffff','#d9ead3','']]);
  assert.equal(record.track,'Track 1');
  assert.equal(record.comment,'Full description');
  assert.equal(record.prodSourceStatus,'');
  assert.equal(record.devSourceStatus,'green');
  assert.equal(iso(record.prod.start),'2026-10-01');
  assert.equal(record.featureColumn,'C');
  const reordered=read([['Feature','Dev Dates','comment','Track','Month','Prod Dates','Team'],['Feature','1.09.26 - 20.09.26','Description','Track 2','October','1.10.26 - 20.10.26','Team']], [[],['','#ffff00','','','','#d9ead3']]);
  assert.equal(reordered.featureColumn,'A');
  assert.equal(reordered.devSourceStatus,'yellow');
  assert.equal(reordered.prodSourceStatus,'green');
  assert.equal(reordered.comment,'Description');
});

test('grouping uses Track only, with no sticker/LTD name rules and no merged blank tracks',()=>{
  const {run}=setup();
  const groups=run(`scheduleGroups(normalize(${JSON.stringify([headers,
    ['October','','Stickers A','Team','Together','1.10 - 10.10','1.09 - 20.09'],
    ['October','','LTD','Team','Together','11.10 - 20.10','1.09 - 20.09'],
    ['October','','Stickers B','Team','Separate','21.10 - 30.10','1.09 - 20.09'],
    ['October','','Stickers C','Team','','1.10 - 10.10','1.09 - 20.09'],
    ['October','','Stickers C','Team','','11.10 - 20.10','1.09 - 20.09']])}))`);
  assert.equal(groups.length,4);
  assert.equal(groups.find(group=>group.track==='Together').records.length,2);
});

test('estimated development starts 30 days before production and lasts 14 inclusive days',()=>{
  const {run}=setup();
  const read=run('rows=>normalize(rows)');
  const records=read([headers,
    ['March','','Feature','Team','Track','15.03.2028 - 30.03.2028',''],
    ['March','','Other','Team','Track','',''],
    ['March','','Manual','Team','Track','15.03.2028 - 30.03.2028','01.01.28 - 10.01.28']]);
  assert.equal(records[0].dev,null);
  assert.equal(iso(records[0].estimatedDev.start),'2028-02-14');
  assert.equal(iso(records[0].estimatedDev.end),'2028-02-27');
  assert.equal(iso(records[1].estimatedDev.start),'2027-01-30');
  assert.equal(iso(records[1].estimatedDev.end),'2027-02-12');
  assert.equal(records[2].estimatedDev,null);
  assert.equal(iso(records[2].dev.start),'2028-01-01');
  const newYear=read([headers,['January','','Feature','Team','Track','10.01.2027 - 20.01.2027','']])[0];
  assert.equal(iso(newYear.estimatedDev.start),'2026-12-11');
  assert.equal(iso(newYear.estimatedDev.end),'2026-12-24');
  assert.equal(run('duration')(newYear.estimatedDev),14);
});

test('current, planned and estimated development toggles operate independently and exclude done work',()=>{
  const {run}=setup();
  assert.deepEqual(Array.from(run('[state.showDev,state.showLate,state.showPlanned,state.showEstimates,state.showProd]')),[true,false,false,false,true]);
  run('state.showPlanned=true;state.showEstimates=true');
  const inspect=run(`rows=>normalize(rows).map(record=>({entries:scheduleEntries(record),warnings:recordWarnings(record)}))`);
  const rows=[headers,
    ['October','','Current','Team','Track','1.10 - 20.10','1.09 - 30.09'],
    ['November','','Future','Team','Track','1.11 - 20.11','1.10 - 30.10'],
    ['November','','Estimated','Team','Track','1.11 - 20.11','']];
  const records=inspect(rows);
  assert.ok(records[0].entries.some(entry=>entry.kind==='dev'));
  assert.ok(records[0].warnings.some(warning=>warning.includes('no status color')));
  assert.ok(records[1].entries.some(entry=>entry.kind==='dev'));
  assert.ok(records[2].entries.some(entry=>entry.kind==='dev'));
  run('state.showDev=false;state.showEstimates=false');
  assert.deepEqual(Array.from(inspect(rows),record=>record.entries.some(entry=>entry.kind==='dev')),[false,true,false]);
  run('state.showPlanned=false;state.showDev=true;state.showEstimates=true');
  assert.deepEqual(Array.from(inspect(rows),record=>record.entries.some(entry=>entry.kind==='dev')),[true,false,true]);
  run('state.showDev=false;state.showEstimates=false');
  const hidden=inspect(rows);
  assert.ok(hidden.every(record=>record.entries.every(entry=>entry.kind!=='dev')));
  const done=run(`(()=>{const record=normalize(${JSON.stringify([headers,['October','','Done','Team','Track','1.10 - 20.10','1.09 - 30.09']])})[0];state.showDev=true;record.devSourceStatus='green';return {entries:scheduleEntries(record),warnings:recordWarnings(record)};})()`);
  assert.ok(!done.entries.some(entry=>entry.kind==='dev'));
  assert.ok(!done.warnings.some(warning=>warning.includes('no status color')));
});

test('late development stays visible after its deadline and has an independent toggle',()=>{
  const {run}=setup();
  run('state.showLate=true');
  run(`state.records=normalize(${JSON.stringify([headers,
    ['January','','LTD overdue','Team','Track','1.01.27 - 20.01.27','7.09.26 - 14.09.26'],
    ['October','','Done dev','Team','Track','1.10 - 20.10','1.09 - 14.09'],
    ['October','','Manually late','Team','Track','1.10 - 20.10','1.09 - 30.09'],
    ['October','','Done prod','Team','Track','1.10 - 20.10','1.09 - 14.09'],
    ['October','','Outside range','Team','Track','1.10 - 20.10','1.01.26 - 14.01.26']])});
    state.records[1].devSourceStatus='green';
    state.records[2].devSourceStatus='red';
    state.records[3].prodSourceStatus='green';`);
  const counts=()=>Array.from(run(`state.records.map(record=>scheduleEntries(record).filter(entry=>entry.kind==='dev').length)`));
  assert.deepEqual(counts(),[1,0,1,0,0]);
  assert.equal(run(`scheduleStatus(state.records[0],'dev')`),'red');
  run('state.showLate=false');
  assert.deepEqual(counts(),[0,0,0,0,0]);
  run('state.showLate=true;state.showDev=false;state.showPlanned=false;state.showEstimates=false');
  assert.deepEqual(counts(),[1,0,1,0,0]);
});

test('same-team alerts check only development, including estimates and shared boundary days',()=>{
  const {run}=setup();
  const conflicts=run(`findTeamConflicts(normalize(${JSON.stringify([headers,
    ['October','','A','Team','Track 1','1.10 - 20.10','1.09 - 20.09'],
    ['September','','B','Team','Track 2','16.09 - 5.10',''],
    ['October','','C','Team','Track 3','1.10 - 20.10',''],
    ['October','','D','Team','Track 3','1.10 - 20.10','20.09 - 25.09'],
    ['October','','Other team','Other','Track 4','1.10 - 20.10','1.09 - 20.09'],
    ['October','','Unassigned 1','','Track 5','1.10 - 20.10',''],
    ['October','','Unassigned 2','','Track 6','1.10 - 20.10','']])}))`);
  assert.deepEqual(Array.from(conflicts,conflict=>`${conflict.a.feature}/${conflict.b.feature}`).sort(),['A/C','A/D']);
  assert.ok(conflicts.every(conflict=>conflict.phaseA==='dev'&&conflict.phaseB==='dev'));
  assert.ok(conflicts.some(conflict=>conflict.estimated));
  const manual=conflicts.find(conflict=>conflict.a.feature==='A'&&conflict.b.feature==='D');
  assert.equal(manual.estimated,false);
  assert.equal(iso(manual.start),'2026-09-20');
  assert.equal(iso(manual.end),'2026-09-20');
  assert.ok(conflicts.every(conflict=>conflict.a.id!==conflict.b.id&&conflict.a.team==='Team'&&conflict.b.team==='Team'));
});

test('completed features never cause overlap warnings for themselves or unfinished features',()=>{
  const {run}=setup();
  run(`state.records=normalize(${JSON.stringify([headers,
    ['October','','Done first','Team','Track','1.10 - 20.10','1.09 - 20.09'],
    ['October','','Active','Team','Track','1.10 - 20.10','1.09 - 20.09'],
    ['October','','Done last','Team','Track','1.10 - 20.10','1.09 - 20.09'],
    ['October','','Production marked done','Team','Track','1.10 - 20.10','1.09 - 20.09'],
    ['October','','Estimated','Team','Track','1.10 - 20.10','']])});
    state.records[0].devSourceStatus='green';
    state.records[2].devSourceStatus='green';
    state.records[3].prodSourceStatus='green';
    state.conflicts=findTeamConflicts(state.records);`);
  assert.deepEqual(Array.from(run('state.conflicts'),conflict=>[conflict.a.feature,conflict.b.feature]),[['Active','Estimated']]);
  for (const index of [0,2,3]) assert.ok(!run(`recordWarnings(state.records[${index}])`).some(warning=>warning.includes('overlapping')));
  assert.ok(run('recordWarnings(state.records[1])').some(warning=>warning.includes('1 other feature')));
});

test('presets use inclusive day counts and correct month/year boundaries',()=>{
  const {run}=setup();
  const preset=run('presetRange');
  for (const days of [30,60,90]) {
    const last=preset(`last${days}`,new Date(2026,0,15));
    assert.equal((last.end-last.start)/86400000,days);
    assert.equal(iso(last.end),'2026-01-16');
    const next=preset(`next${days}`,new Date(2026,0,15));
    assert.equal((next.end-next.start)/86400000,days);
  }
  const previous=preset('lastMonth',new Date(2026,0,15));
  assert.equal(iso(previous.start),'2025-12-01');
  assert.equal(iso(previous.end),'2026-01-01');
  for (const [months,start,end] of [[6,'2025-11-01','2026-05-01'],[8,'2025-11-01','2026-07-01'],[10,'2025-11-01','2026-09-01']]) {
    const planning=preset(`planning${months}months`,new Date(2026,0,31));
    assert.equal(iso(planning.start),start);
    assert.equal(iso(planning.end),end);
  }
});

test('bars show status icons, estimate warnings and escaped feature text',()=>{
  const {run}=setup();
  const html=run(`(()=>{const record=normalize(${JSON.stringify([headers,['October','','<Feature "x">','Team','Track','10.10 - 20.10','']])})[0];return featureBar(record,record.estimatedDev,'dev',14,true);})()`);
  assert.match(html,/dev-overlay/);
  assert.match(html,/estimated/);
  assert.match(html,/⚙/);
  assert.match(html,/warning/);
  assert.match(html,/&lt;Feature &quot;x&quot;&gt;/);
  assert.doesNotMatch(html,/<Feature/);
  const missing=run(`(()=>{const record=normalize(${JSON.stringify([headers,['October','','Feature','Team','Track','','']])})[0];return featureBar(record,placeholderRange(record),'missing',14);})()`);
  assert.match(missing,/No Prod &amp; Dev Dates/);
});

test('production status respects explicit yellow sheet color',()=>{
  const {run}=setup();
  const record=run(`normalize(${JSON.stringify([headers,['October','','Feature','Team','Track','1.10 - 20.10','1.10 - 5.10']])})[0]`);
  record.prodSourceStatus='yellow';
  assert.equal(run('scheduleStatus')(record,'prod'),'yellow');
});

test('development connectors join only matching visible boxes and follow layer toggles',()=>{
  const {run}=setup();
  run('state.showPlanned=true;state.showEstimates=true');
  run(`state.records=normalize(${JSON.stringify([headers,
    ['October','','Current','Team','Together','1.10 - 20.10','1.09 - 30.09'],
    ['October','','Overlapping phases','Other','Together','10.10 - 20.10','1.10 - 15.10'],
    ['November','','Estimated','Team','Together','1.11 - 20.11',''],
    ['March','','Production outside view','Team','Together','1.03.27 - 20.03.27','1.10 - 15.10'],
    ['November','','Missing production','Team','Together','','']])});`);
  const render=()=>run(`scheduleGroups(state.records).map(group=>scheduleRow(group,'')).join('')`);
  const html=render();
  assert.deepEqual([...html.matchAll(/data-feature-id="(\d+)"/g)].map(match=>Number(match[1])).sort(),[0,1,2,4]);
  assert.match(html,/phase-connector dev-status-yellow/);
  assert.match(html,/phase-connector dev-status-scheduled estimated/);
  assert.doesNotMatch(html,/NaN|undefined/);
  run('state.showProd=false');
  assert.doesNotMatch(render(),/class="phase-connectors"/);
  run('state.showProd=true;state.showDev=false;state.showPlanned=false;state.showEstimates=false');
  assert.doesNotMatch(render(),/class="phase-connectors"/);
});

test('connector anchors do not overshoot and double back into hooked joins',()=>{
  const {run}=setup(), simplify=run('simplifyConnectorPoints'), rounded=run('roundedConnectorPath');
  const points=[{x:40,y:25},{x:40,y:40},{x:40,y:32},{x:60,y:32},{x:60,y:40},{x:60,y:25}];
  assert.deepEqual(Array.from(simplify(points),p=>[p.x,p.y]),[[40,25],[40,32],[60,32],[60,25]]);
  assert.doesNotMatch(rounded(points),/NaN|undefined/);
  assert.equal(rounded(points),rounded(simplify(points)));
});

test('unobstructed connections on the same lane are straight, while occupied gaps route around boxes',()=>{
  const {run}=setup();
  const route=run('connectorRoute');
  const dev={left:10,width:20,top:14},prod={left:60,width:10,top:14};
  const points=route(dev,prod,[dev,prod]);
  assert.deepEqual(Array.from(points,p=>[p.x,p.y]),[[300,26.5],[600,26.5]]);
  const blocker={left:40,width:10,top:14};
  assert.ok(route(dev,prod,[dev,blocker,prod]).length>2);
});

test('connector routes reach their own production box without crossing intervening features',()=>{
  const {run}=setup(), route=run('connectorRoute');
  // Reproduce the packed Season Pass row: September/October development,
  // December production, and other monthly production boxes in between.
  const entries=[
    {left:0,width:16.57,top:14},
    {left:3.31,width:8.29,top:47},
    {left:11.05,width:8.29,top:80},
    {left:16.57,width:17.13,top:14},
    {left:33.70,width:16.57,top:14},
    {left:35.91,width:8.29,top:47},
    {left:45.86,width:8.28,top:47},
    {left:50.28,width:17.12,top:14},
    {left:67.40,width:17.13,top:14},
    {left:84.53,width:15.47,top:47}
  ];
  for (const [source,target] of [[1,4],[2,7],[5,8],[6,9],[7,2]]) {
    const points=route(entries[source],entries[target],entries);
    assert.ok(points.length>=2,`Missing route ${source} → ${target}`);
    const straight=points.length===2;
    const targetX=straight?(entries[source].left<entries[target].left?entries[target].left:entries[target].left+entries[target].width)*10:entries[target].left*10+Math.min(6,entries[target].width*5);
    assert.equal(points.at(-1).x,targetX);
    assert.equal(points.at(-1).y,entries[target].top+(straight?12.5:entries[source].top<entries[target].top?0:25));
    if (entries[source].top<entries[target].top) assert.ok(points.at(-2).y<points.at(-1).y,'Approach lower production boxes from above without a bottom hook');
    if (entries[source].top>entries[target].top) {
      assert.equal(points[0].y,entries[source].top);
      assert.ok(points[1].y<points[0].y,'Leave lower development boxes upwards without a bottom detour');
    }
    for (let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];
      assert.ok(a.x===b.x||a.y===b.y,'Routes must be orthogonal');
      for (const box of entries) {
        const left=box.left*10,right=(box.left+box.width)*10,bottom=box.top+25;
        const crosses=a.x===b.x
          ? a.x>left&&a.x<right&&Math.min(a.y,b.y)<bottom&&Math.max(a.y,b.y)>box.top
          : a.y>box.top&&a.y<bottom&&Math.min(a.x,b.x)<right&&Math.max(a.x,b.x)>left;
        assert.equal(crosses,false,`Route ${source} → ${target} crosses another feature box`);
      }
    }
  }
  // Use the displayed lane spacing and route the crowded connections together.
  // Previously the January/February routes merged along the same horizontal line.
  const spaced=entries.map(entry=>({...entry,top:14+(entry.top-14)/33*run('SCHEDULE_LANE_STEP')}));
  const occupied=[];
  for (const [source,target] of [[1,4],[2,7],[5,8],[6,9]]) {
    const points=route(spaced[source],spaced[target],spaced,occupied);
    assert.ok(points.length>=2);
    for (let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];
      for (const used of occupied) {
        const axis=a.y===b.y&&used.a.y===used.b.y&&Math.abs(a.y-used.a.y)<6?'x':a.x===b.x&&used.a.x===used.b.x&&Math.abs(a.x-used.a.x)<6?'y':null;
        if (!axis) continue;
        const shared=Math.min(Math.max(a[axis],b[axis]),Math.max(used.a[axis],used.b[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(used.a[axis],used.b[axis]));
        assert.ok(shared<=.001,`Connections run too close along a ${shared}-unit segment`);
      }
    }
    points.slice(1).forEach((point,i)=>occupied.push({a:points[i],b:point}));
  }
});
