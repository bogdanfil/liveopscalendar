const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const headers=['Month','Event','Feature','Development Team','Track','Prod Dates','Dev Dates','comment'];
const success=()=>({ok:true,json:async()=>({rows:[headers,['October','','Feature','Team','Track','1.10.26 - 20.10.26','','Description']],backgrounds:[]})});

function setup(fetch) {
  const timers=new Map(),waits=[],frames=[],classes=new Set();
  const status={classList:{add:value=>classes.add(value),remove:(...values)=>values.forEach(value=>classes.delete(value))},lastElementChild:{textContent:''}};
  let timerId=0;
  const context=vm.createContext({window:{LIVEOPS_DATA_ENDPOINT:'https://example.test/sheet'},fetch,AbortController,TypeError,console:{warn(){},error(){}},document:{querySelector:()=>status},
    setTimeout(callback,delay){const id=++timerId;timers.set(id,callback);waits.push(delay);if(delay<5000) queueMicrotask(()=>{if(timers.has(id))callback();});return id;},
    clearTimeout:id=>timers.delete(id),capture:html=>frames.push(html)});
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('// UI event bindings')),context);
  vm.runInContext(fs.readFileSync(path.join(root,'calendar-ui.js'),'utf8'),context);
  vm.runInContext('render=()=>capture(loadingMessage())',context);
  return {run:code=>vm.runInContext(code,context),context,timers,waits,frames,status,classes};
}

test('connection failures retry twice, show a readable error, and recover on manual retry',async()=>{
  let calls=0,online=false;
  const app=setup(async()=>{calls++;if(!online)throw new TypeError('Failed to fetch');return success();});
  await app.run('loadData()');
  assert.equal(calls,3);
  assert.deepEqual(app.waits,[10000,1000,10000,2000,10000]);
  assert.equal(app.run('state.loadPhase'),'error');
  assert.match(app.frames.at(-1),/couldn’t connect to Google Sheets/);
  assert.match(app.frames.at(-1),/id="retryLoad">Try again/);
  assert.doesNotMatch(app.frames.at(-1),/No events|No features/);
  assert.ok(app.frames.some(frame=>frame.includes('Attempt 2 of 3')));
  assert.ok(app.frames.some(frame=>frame.includes('Attempt 3 of 3')));
  online=true;
  await app.run('loadData()');
  assert.equal(calls,4);
  assert.equal(app.run('state.loadPhase'),'loaded');
  assert.equal(app.run('state.records.length'),1);
  assert.equal(app.classes.has('error'),false);
  assert.equal(app.classes.has('live'),true);
});

test('transient server errors recover automatically, while denied access is explained immediately',async()=>{
  let calls=0;
  const transient=setup(async()=>++calls<3?{ok:false,status:503}:success());
  await transient.run('loadData()');
  assert.equal(calls,3);
  assert.equal(transient.run('state.loadPhase'),'loaded');
  const denied=setup(async()=>({ok:false,status:403}));
  await denied.run('loadData()');
  assert.deepEqual(denied.waits,[10000]);
  assert.match(denied.frames.at(-1),/check sharing access/);
});

test('timeout covers response body reading and aborts the request',async()=>{
  let signal,bodyStarted;
  const ready=new Promise(resolve=>{bodyStarted=resolve;});
  const app=setup(async(url,options)=>{
    signal=options.signal;
    return {ok:true,json:()=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));bodyStarted();})};
  });
  const pending=app.run("fetchSheet('https://example.test/sheet','json')");
  await ready;
  app.timers.values().next().value();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(signal.aborted,true);
  assert.equal(app.timers.size,0);
});

test('overlapping load requests are ignored and a valid empty sheet loads successfully',async()=>{
  let resolve,calls=0;
  const app=setup(()=>{calls++;return new Promise(done=>{resolve=done;});});
  const first=app.run('loadData()');
  await app.run('loadData()');
  assert.equal(calls,1);
  resolve({ok:true,json:async()=>({rows:[headers],backgrounds:[]})});
  await first;
  assert.equal(app.run('state.loadPhase'),'loaded');
  assert.equal(app.run('state.records.length'),0);
});
