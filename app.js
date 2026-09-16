const now = new Date();
const todayDate = new Date(now.getFullYear(),now.getMonth(),now.getDate());
const cycleYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear()-1;
const CONFIG = {
  spreadsheetId: "1wWJXhI2wvO_BQlzvSZRov1deL7FLMMFPlqAV9dDHeqA",
  gid: "1371010002",
  dataEndpoint: window.LIVEOPS_DATA_ENDPOINT||"",
  cycleStart: new Date(cycleYear, 7, 1),
  cycleEnd: new Date(cycleYear+1, 7, 1)
};

const state = { records: [], cellStatuses:{}, conflicts:[], sortBy:"team", showDev:false, showLate:false, showPlanned:false, showEstimates:false, showProd:true, rangeStart:new Date(now.getFullYear(),now.getMonth()-1,1), rangeEnd:new Date(now.getFullYear(),now.getMonth()+5,1) };

function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i], next=text[i+1];
    if (ch==='"' && quoted && next==='"') { cell+='"'; i++; }
    else if (ch==='"') quoted=!quoted;
    else if (ch===',' && !quoted) { row.push(cell); cell=""; }
    else if ((ch==='\n' || ch==='\r') && !quoted) {
      if (ch==='\r' && next==='\n') i++;
      row.push(cell); rows.push(row); row=[]; cell="";
    } else cell+=ch;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  while (rows.length && !rows.at(-1).some(Boolean)) rows.pop();
  return rows;
}

function parseRange(value) {
  if (!value) return null;
  const text=String(value).replace(/&(?:nbsp|#0*32|#x0*20);/gi,' ').trim();
  const parts=text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?$/);
  if (!parts) return null;
  const [,startDay,startMonth,,endDay,endMonth]=parts.map(Number);
  const parseYear=year=>year===undefined?null:Number(year)+(year.length===2?2000:0);
  const startYearText=parseYear(parts[3]), endYearText=parseYear(parts[6]);
  const crossesYear=endMonth<startMonth||(endMonth===startMonth&&endDay<startDay);
  const startYear=startYearText??(endYearText!==null?endYearText-Number(crossesYear):startMonth>=8?cycleYear:cycleYear+1);
  const endYear=endYearText??startYear+Number(crossesYear);
  const make=(day,month,year)=>{
    const date=new Date(year,month-1,day);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:null;
  };
  const start=make(startDay,startMonth,startYear), end=make(endDay,endMonth,endYear);
  if (!start||!end||end<start) return null;
  return { start, end };
}

function sheetColumns(headers=[]) {
  const names=headers.map(value=>String(value||'').trim().toLowerCase());
  const find=(...aliases)=>names.findIndex(name=>aliases.includes(name));
  return { month:find('month'), event:find('event'), feature:find('feature'), team:find('development team','team'), track:find('track'), prod:find('prod dates','production dates'), dev:find('dev dates','development dates'), comment:find('comment','comments','description') };
}

function columnLetter(index) {
  let name='';
  for (let number=index+1;number>0;number=Math.floor((number-1)/26)) name=String.fromCharCode(65+(number-1)%26)+name;
  return name;
}

function mergeDescriptions(rows, csvRows) {
  const commentColumn=sheetColumns(csvRows[0]).comment;
  if (commentColumn<0) throw new Error('Description column missing');
  const header=value=>String(value||'').trim().toLowerCase();
  const shared=rows[0].map((name,index)=>({index,csvIndex:csvRows[0].findIndex(other=>header(name)===header(other))}));
  if (shared.some(column=>column.csvIndex<0)) throw new Error('Sheet columns changed between reads');
  const cell=value=>String(value??'').trim();
  // Google Visualization omits empty physical rows. Match the nonempty rows
  // in order, while retaining Apps Script row numbers and color alignment.
  const source=rows.map((row,index)=>({row,index})).slice(1).filter(({row})=>shared.some(column=>cell(row[column.index])));
  const values=csvRows.slice(1).filter(row=>shared.some(column=>cell(row[column.csvIndex])));
  if (source.length!==values.length||source.some(({row},index)=>shared.some(column=>cell(row[column.index])!==cell(values[index][column.csvIndex])))) throw new Error('Sheet changed between reads');
  const result=rows.map(row=>[...row]);
  const destination=rows[0].length;
  result[0][destination]=csvRows[0][commentColumn];
  source.forEach(({index},position)=>{result[index][destination]=values[position][commentColumn]||'';});
  return result;
}

function normalize(rows) {
  const columns=sheetColumns(rows[0]);
  if (['month','feature','prod','dev'].some(key=>columns[key]<0)) throw new Error('Required sheet columns are missing');
  const value=(row,key)=>String(row[columns[key]]||'').trim();
  let month="", event="";
  return rows.slice(1).map((row,index)=> {
    if (!row.some(Boolean)) return null;
    if (value(row,'month')) { month=value(row,'month'); event=""; }
    if (value(row,'event')) event=value(row,'event');
    const feature=value(row,'feature');
    if (!feature) return null;
    const sheetRow=index+2;
    const prodText=value(row,'prod'), devText=value(row,'dev'), statuses=state.cellStatuses;
    const record={ id:index, sheetRow, featureColumn:columnLetter(columns.feature), month, event, feature, type:feature, track:value(row,'track'), title:feature, team:value(row,'team')||'Unassigned', prodText, devText, comment:value(row,'comment'), prod:parseRange(prodText), dev:parseRange(devText), prodSourceStatus:statuses[`${sheetRow}:${columnLetter(columns.prod)}`]||'', devSourceStatus:statuses[`${sheetRow}:${columnLetter(columns.dev)}`]||'' };
    record.estimatedDev=record.dev?null:estimateDevelopment(record);
    return record;
  }).filter(Boolean);
}

async function fetchSheet(url,format,timeout=10000) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if (!response.ok) {
      const error=new Error(`HTTP ${response.status}`);
      error.status=response.status;
      throw error;
    }
    return await (format==='json'?response.json():response.text());
  } finally { clearTimeout(timer); }
}

function sheetErrorMessage(error) {
  if (error.status===401||error.status===403) return 'Google did not allow access to the schedule. Please ask the calendar owner to check sharing access.';
  if (error.name==='AbortError') return 'Google is taking too long to respond. Please check your connection and try again in a moment.';
  if (error instanceof TypeError) return 'We couldn’t connect to Google Sheets. Please check your internet connection and try again.';
  if (error.status===429||error.status>=500) return 'Google Sheets is temporarily unavailable. Please try again in a moment.';
  return 'We couldn’t read the schedule from Google Sheets. Please try again. If this keeps happening, contact the calendar owner.';
}

async function loadData() {
  if (state.loadPhase==='loading') return;
  const status=document.querySelector("#syncStatus");
  const url=`https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}`;
  state.loadPhase='loading';
  state.loadError='';
  status.classList.remove('live','error');
  for (let attempt=1;attempt<=3;attempt++) {
    state.loadAttempt=attempt;
    status.lastElementChild.textContent=attempt===1?'Loading schedule':`Retrying · attempt ${attempt} of 3`;
    render();
    try {
      const payload=await fetchSheet(CONFIG.dataEndpoint||url,CONFIG.dataEndpoint?'json':'text');
      let rows;
      state.cellStatuses={};
      if (CONFIG.dataEndpoint) {
        rows=payload.rows;
        if (!Array.isArray(rows)||!Array.isArray(rows[0])) throw new Error('Unexpected sheet format');
        state.cellStatuses=statusesFromBackgrounds(payload.backgrounds||[],rows[0]);
        // Older deployed scripts read only A:G. Recover the shifted description
        // column from CSV only when all shared cells match the colored snapshot.
        if (sheetColumns(rows[0]).comment<0) {
          try {
            const fullRows=parseCsv(await fetchSheet(url,'text',5000));
            rows=mergeDescriptions(rows,fullRows);
          } catch (error) { console.warn('Descriptions unavailable; update the Apps Script deployment to read every column.',error); }
        }
      } else rows=parseCsv(payload);
      state.records=normalize(rows);
      state.conflicts=findTeamConflicts(state.records);
      state.loadPhase='loaded';
      status.classList.add("live"); status.lastElementChild.textContent=CONFIG.dataEndpoint?"Live values + colors":"Live values · colors unavailable";
      if (sheetColumns(rows[0]).comment<0) status.lastElementChild.textContent+=' · descriptions unavailable';
      render();
      return;
    } catch (error) {
      const retryable=error.name==='AbortError'||error instanceof TypeError||error.status===429||error.status>=500;
      if (attempt<3&&retryable) {
        await new Promise(resolve=>setTimeout(resolve,attempt*1000));
        continue;
      }
      state.records=[]; state.conflicts=[];
      state.loadPhase='error'; state.loadError=sheetErrorMessage(error);
      status.classList.add("error"); status.lastElementChild.textContent="Couldn’t load schedule";
      console.error("Live Sheet unavailable.",error);
      break;
    }
  }
  render();
}

function statusesFromBackgrounds(backgrounds,headers=['Month','Event','Feature','Development Team','Prod Dates','Dev Dates','comment']) {
  const columns=sheetColumns(headers);
  const statuses={};
  backgrounds.forEach((row,rowIndex)=>[columns.prod,columns.dev].filter(index=>index>=0).forEach(columnIndex=>{
    const color=String(row[columnIndex]||"").toLowerCase();
    const status=color==="#d9ead3"?"green":color==="#ffff00"?"yellow":color==="#ff0000"?"red":"";
    if (status) statuses[`${rowIndex+1}:${columnLetter(columnIndex)}`]=status;
  }));
  return statuses;
}

function filtered() {
  return state.records.filter(isInWindow).sort(sortRecords);
}

function sortRecords(a,b) {
  const comparisons={ month:()=>plannedMonth(a)-plannedMonth(b), team:()=>a.team.localeCompare(b.team), feature:()=>a.feature.localeCompare(b.feature), holiday:()=>(a.event||"No holiday").localeCompare(b.event||"No holiday") };
  const order=[state.sortBy,...["month","team","feature","holiday"].filter(key=>key!==state.sortBy)];
  for (const key of order) { const result=comparisons[key](); if (result) return result; }
  return 0;
}

function groupValue(record) {
  return ({team:record.team,feature:record.feature,month:record.month,holiday:record.event||"No holiday"})[state.sortBy];
}

function grouped(records) {
  const groups=[];
  records.forEach(record=>{ const name=groupValue(record); let group=groups.at(-1); if (!group||group.name!==name) { group={name,records:[]}; groups.push(group); } group.records.push(record); });
  return groups;
}

function plannedMonth(record) {
  const index=["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(record.month);
  if (index<0) return null;
  return new Date(index>=7?cycleYear:cycleYear+1,index,1);
}

function overlaps(range) { return range && range.end>=state.rangeStart && range.start<state.rangeEnd; }
function developmentRange(record) { return record.dev||record.estimatedDev; }
function activeToday(range) { return Boolean(range&&range.start<=todayDate&&range.end>=todayDate); }
function estimateDevelopment(record) {
  const anchor=record.prod?.start||plannedMonth(record);
  if (!anchor) return null;
  const start=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()-30);
  return {start,end:new Date(start.getFullYear(),start.getMonth(),start.getDate()+13)};
}
function findTeamConflicts(records) {
  const conflicts=[];
  const pending=records.filter(record=>record.devSourceStatus!=='green'&&record.prodSourceStatus!=='green');
  for (let i=0;i<pending.length;i++) {
    const a=pending[i], team=a.team.trim().toLowerCase();
    if (!team||team==='unassigned') continue;
    for (let j=i+1;j<pending.length;j++) {
      const b=pending[j];
      if (b.team.trim().toLowerCase()!==team) continue;
      const aRange=developmentRange(a), bRange=developmentRange(b);
      if (!aRange||!bRange) continue;
      const start=new Date(Math.max(aRange.start,bRange.start)), end=new Date(Math.min(aRange.end,bRange.end));
      if (start<=end) conflicts.push({a,b,phaseA:'dev',phaseB:'dev',start,end,estimated:!a.dev||!b.dev});
    }
  }
  return conflicts;
}
function recordConflicts(record) { return state.conflicts.filter(conflict=>(conflict.a.id===record.id||conflict.b.id===record.id)&&overlaps(conflict)); }
function recordWarnings(record) {
  const warnings=[];
  if (!record.prod) warnings.push(record.prodText&&record.prodText!=='-'?'Production dates could not be read':'No Prod Date');
  if (!record.dev) warnings.push(record.estimatedDev?'Dev dates estimated — not entered in sheet':record.devText&&record.devText!=='-'?'Development dates could not be read':'No Dev Date');
  if (activeToday(developmentRange(record))&&!record.devSourceStatus) warnings.push('Development is active but has no status color in the sheet');
  const conflicts=recordConflicts(record);
  const others=new Set(conflicts.map(conflict=>conflict.a.id===record.id?conflict.b.id:conflict.a.id));
  if (others.size) warnings.push(`${record.team} has overlapping development on ${others.size} other feature${others.size===1?'':'s'}`);
  return warnings;
}
function isInWindow(record) {
  const month=plannedMonth(record);
  const monthEnd=month&&new Date(month.getFullYear(),month.getMonth()+1,1);
  return overlaps(developmentRange(record))||overlaps(record.prod)||(month&&month<state.rangeEnd&&monthEnd>state.rangeStart)||(!month&&!record.dev&&!record.prod);
}

function visibleMonths() {
  const months=[];
  for (let month=new Date(state.rangeStart.getFullYear(),state.rangeStart.getMonth(),1);month<state.rangeEnd;month=new Date(month.getFullYear(),month.getMonth()+1,1)) months.push(month);
  return months;
}

function timelineStyle(months) {
  const columns=months.map(month=>{
    const next=new Date(month.getFullYear(),month.getMonth()+1,1);
    return `${Math.min(next,state.rangeEnd)-Math.max(month,state.rangeStart)}fr`;
  });
  return `--month-columns:${columns.join(' ')};--timeline-width:${Math.max(980,248+months.length*92)}px`;
}

function monthLines() {
  return visibleMonths().slice(1).map(month=>`<i class="month-line" style="left:${offset(month)}%"></i>`).join('');
}

function missingDateLabel(record) {
  return !record.dev&&!record.prod?'No Prod & Dev Dates':!record.prod?'No Prod Date':!record.dev?'No Dev Date':'';
}

function planningWarning(record) {
  const label=recordWarnings(record).join(' · ');
  if (!label) return '';
  return `<b class="warning" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">!</b>`;
}

function inputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

let calendarInput=null, calendarMonth=null;

function closeCalendar(returnFocus=false) {
  document.querySelector('#dateCalendar').hidden=true;
  document.querySelectorAll('[data-date-picker]').forEach(button=>button.setAttribute('aria-expanded','false'));
  if (returnFocus&&calendarInput) document.querySelector(`[data-date-picker="${calendarInput.id}"]`).focus();
}

function renderCalendar() {
  const calendar=document.querySelector('#dateCalendar');
  const year=calendarMonth.getFullYear(), month=calendarMonth.getMonth();
  const firstWeekday=(new Date(year,month,1).getDay()+6)%7;
  const dayCount=new Date(year,month+1,0).getDate();
  const months=Array.from({length:12},(_,i)=>`<option value="${i}" ${i===month?'selected':''}>${new Date(year,i,1).toLocaleDateString('en-US',{month:'long'})}</option>`).join('');
  const years=Array.from({length:21},(_,i)=>year-10+i).map(value=>`<option ${value===year?'selected':''}>${value}</option>`).join('');
  const days=Array.from({length:dayCount},(_,i)=>{
    const date=new Date(year,month,i+1), value=inputDate(date), selected=value===calendarInput.value;
    return `<button type="button" class="calendar-day${selected?' selected':''}" data-calendar-date="${value}" aria-label="${formatDate(date)}" aria-pressed="${selected}" ${value===inputDate(todayDate)?'aria-current="date"':''}>${i+1}</button>`;
  }).join('');
  calendar.innerHTML=`<div class="calendar-heading"><button type="button" data-calendar-shift="-1" aria-label="Previous month">‹</button><select aria-label="Calendar month" id="calendarMonth">${months}</select><select aria-label="Calendar year" id="calendarYear">${years}</select><button type="button" data-calendar-shift="1" aria-label="Next month">›</button></div><div class="calendar-days">${['Mo','Tu','We','Th','Fr','Sa','Su'].map(day=>`<span class="calendar-weekday">${day}</span>`).join('')}${'<span></span>'.repeat(firstWeekday)}${days}</div>`;
}

function openCalendar(input) {
  calendarInput=input;
  const parts=(input.value||inputDate(todayDate)).split('-').map(Number);
  calendarMonth=new Date(parts[0],parts[1]-1,1);
  renderCalendar();
  const calendar=document.querySelector('#dateCalendar');
  calendar.hidden=false;
  const rect=input.closest('.date-input').getBoundingClientRect();
  calendar.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-calendar.offsetWidth-8))}px`;
  calendar.style.top=`${Math.max(8,Math.min(rect.bottom+6,window.innerHeight-calendar.offsetHeight-8))}px`;
  document.querySelectorAll('[data-date-picker]').forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.datePicker===input.id)));
  calendar.querySelector('.selected, .calendar-day').focus();
}

function updateDateRange() {
  const startInput=document.querySelector('#rangeStart'), endInput=document.querySelector('#rangeEnd');
  endInput.setCustomValidity('');
  if (!startInput.value||!endInput.value) return;
  if (startInput.value>endInput.value) {
    endInput.setCustomValidity('Choose an end date on or after the start date.');
    endInput.reportValidity();
    return;
  }
  const [startYear,startMonth,startDay]=startInput.value.split('-').map(Number);
  const [endYear,endMonth,endDay]=endInput.value.split('-').map(Number);
  state.rangeStart=new Date(startYear,startMonth-1,startDay);
  state.rangeEnd=new Date(endYear,endMonth-1,endDay+1);
  document.querySelector('#rangePreset').value='custom';
  render();
}

function presetRange(preset,reference=todayDate) {
  const day=(offset=0)=>new Date(reference.getFullYear(),reference.getMonth(),reference.getDate()+offset);
  const last=preset.match(/^last(\d+)$/), next=preset.match(/^next(\d+)$/);
  if (last) return {start:day(1-Number(last[1])),end:day(1)};
  if (next) return {start:day(),end:day(Number(next[1]))};
  if (preset==='today') return {start:day(),end:day(1)};
  if (preset==='yesterday') return {start:day(-1),end:day()};
  if (preset==='lastMonth') return {start:new Date(reference.getFullYear(),reference.getMonth()-1,1),end:new Date(reference.getFullYear(),reference.getMonth(),1)};
  if (preset==='thisMonth') return {start:new Date(reference.getFullYear(),reference.getMonth(),1),end:new Date(reference.getFullYear(),reference.getMonth()+1,1)};
  if (preset==='next6months') return {start:new Date(reference.getFullYear(),reference.getMonth(),1),end:new Date(reference.getFullYear(),reference.getMonth()+6,1)};
  if (preset==='planning6monthsForward') return {start:new Date(reference.getFullYear(),reference.getMonth()-1,1),end:new Date(reference.getFullYear(),reference.getMonth()+5,1)};
  const planningMonths=preset.match(/^planning(6|8|10)months$/);
  if (planningMonths) {
    const forward=Number(planningMonths[1])-2;
    return {start:new Date(reference.getFullYear(),reference.getMonth()-2,1),end:new Date(reference.getFullYear(),reference.getMonth()+forward,1)};
  }
  if (preset==='cycle') return {start:CONFIG.cycleStart,end:CONFIG.cycleEnd};
  return null;
}

function applyDatePreset() {
  const preset=document.querySelector('#rangePreset').value;
  document.querySelector('#customDates').hidden=preset!=='custom';
  const range=presetRange(preset);
  if (range) { state.rangeStart=range.start; state.rangeEnd=range.end; }
  document.querySelector('#rangeStart').value=inputDate(state.rangeStart);
  document.querySelector('#rangeEnd').value=inputDate(new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),state.rangeEnd.getDate()-1));
  document.querySelector('#rangeEnd').setCustomValidity('');
  closeCalendar();
  render();
}

function formatDate(date) { return date?date.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"Not scheduled"; }
function duration(range) { return range?Math.round((range.end-range.start)/86400000)+1:0; }
function offset(date) { return Math.max(0,Math.min(100,(date-state.rangeStart)/(state.rangeEnd-state.rangeStart)*100)); }
function escapeHtml(value) { return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }

function scheduleStatus(record,kind) {
  const range=kind==='dev'?developmentRange(record):record.prod, source=record[`${kind}SourceStatus`];
  if (!range) return "missing";
  if (source==='green') return 'green';
  if (source==='red') return 'red';
  if (kind==="prod") {
    if (source==='yellow') return 'yellow';
    const devStatus=developmentRange(record)?scheduleStatus(record,"dev"):null;
    if (devStatus==="red") return "red";
    if (devStatus==="green") return "green";
    if (devStatus==="yellow") return "yellow";
    return range.start>todayDate ? "scheduled" : "green";
  }
  if (range.end<todayDate) return "red";
  if (source==='yellow'||activeToday(range)) return "yellow";
  return "scheduled";
}

function statusLabel(status,kind) {
  return ({green:"Done",yellow:"In progress",red:"Late",scheduled:"Planned",missing:"No dates"})[status];
}

function statusIcon(status) {
  return `<span class="status-icon icon-${status}" aria-hidden="true">${({green:'✓',yellow:'⚙',red:'!',scheduled:'◷',missing:'!'})[status]}</span>`;
}

// UI event bindings
document.querySelector('#showDevelopment').addEventListener('click',event=>{
  const visible=!state.showDev;
  state.showDev=state.showLate=state.showPlanned=state.showEstimates=visible;
  event.currentTarget.setAttribute('aria-pressed',String(visible));
  event.currentTarget.title=`${visible?'Hide':'Show'} all development: current, late, planned, and estimated`;
  render();
});
document.querySelector("#showProd").addEventListener("change",event=>{ state.showProd=event.target.checked; render(); });
document.querySelector('#rangeStart').value=inputDate(state.rangeStart);
document.querySelector('#rangeEnd').value=inputDate(new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),0));
document.querySelector('#rangeStart').addEventListener('change',updateDateRange);
document.querySelector('#rangeEnd').addEventListener('change',updateDateRange);
document.querySelector('#rangePreset').addEventListener('change',applyDatePreset);
document.querySelectorAll('[data-date-picker]').forEach(button=>{
  const input=document.getElementById(button.dataset.datePicker);
  input.classList.add('has-picker-button');
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-controls','dateCalendar');
  button.setAttribute('aria-expanded','false');
  button.addEventListener('click',()=>{
    if (calendarInput===input&&!document.querySelector('#dateCalendar').hidden) closeCalendar();
    else openCalendar(input);
  });
  input.addEventListener('click',()=>openCalendar(input));
});
document.querySelector('#dateCalendar').addEventListener('click',event=>{
  const day=event.target.closest('[data-calendar-date]');
  if (day) {
    calendarInput.value=day.dataset.calendarDate;
    closeCalendar(true);
    calendarInput.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const shift=event.target.closest('[data-calendar-shift]');
  if (shift) {
    calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(shift.dataset.calendarShift),1);
    renderCalendar();
    document.querySelector(`[data-calendar-shift="${shift.dataset.calendarShift}"]`).focus();
  }
});
document.querySelector('#dateCalendar').addEventListener('change',event=>{
  if (event.target.id==='calendarMonth'||event.target.id==='calendarYear') {
    calendarMonth=new Date(Number(document.querySelector('#calendarYear').value),Number(document.querySelector('#calendarMonth').value),1);
    renderCalendar();
    document.getElementById(event.target.id).focus();
  }
});
document.addEventListener('click',event=>{
  if (!event.target.closest('#dateCalendar, .date-input')) closeCalendar();
});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape') hideTooltip();
  if (event.key==='Escape'&&!document.querySelector('#dateCalendar').hidden) { event.preventDefault(); closeCalendar(true); }
});
window.addEventListener('resize',()=>{closeCalendar();hideTooltip();render();});
window.addEventListener('scroll',event=>{ if (!(event.target instanceof Node)||!document.querySelector('#dateCalendar').contains(event.target)) closeCalendar(); hideTooltip(); },true);
document.querySelector(".dialog-close").addEventListener("click",()=>document.querySelector("#detailDialog").close());
document.querySelector("#detailDialog").addEventListener("click",event=>{ if(event.target===event.currentTarget) event.currentTarget.close(); });

loadData();
