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

const TYPE_COLORS = { Sale:"#d07858", Stickers:"#a86d9e", "Season Pass":"#547baa", LTD:"#c39335", Adventure:"#3f8d81", Expedition:"#7b6fa8" };
const state = { records: [], cellStatuses:{}, view:"schedule", search:"", team:"", feature:"", sortBy:"team", showDev:true, showProd:true, rangeStart:new Date(now.getFullYear(),now.getMonth(),1), rangeEnd:new Date(now.getFullYear(),now.getMonth()+6,1) };

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
  const parts=String(value).trim().match(/(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})/);
  if (!parts) return null;
  const make=(day,month)=>new Date(Number(month)>=8?cycleYear:cycleYear+1,Number(month)-1,Number(day));
  const start=make(parts[1],parts[2]); let end=make(parts[3],parts[4]);
  if (end<start) end=new Date(end.getFullYear()+1,end.getMonth(),end.getDate());
  return { start, end };
}

function normalize(rows) {
  let month="", event="";
  return rows.slice(1).map((row,index)=> {
    if (!row.some(Boolean)) return null;
    if (row[0]) { month=row[0].trim(); event=""; }
    if (row[1]) event=row[1].trim();
    const feature=(row[2]||"").trim();
    if (!feature) return null;
    const type=feature.startsWith("Stickers")?"Stickers":feature;
    const sheetRow=index+2;
    const prodText=(row[4]||"").trim(), devText=(row[5]||"").trim(), statuses=state.cellStatuses;
    return { id:index, sheetRow, month, event, feature, type, title:feature, team:(row[3]||"Unassigned").trim()||"Unassigned", prodText, devText, comment:(row[6]||"").trim(), prod:parseRange(prodText), dev:parseRange(devText), prodSourceStatus:statuses[`${sheetRow}:E`]||statuses[`${feature}|${prodText}:E`]||"", devSourceStatus:statuses[`${sheetRow}:F`]||statuses[`${feature}|${devText}:F`]||"" };
  }).filter(Boolean);
}

async function loadData() {
  const status=document.querySelector("#syncStatus");
  const url=`https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}`;
  try {
    const response=await fetch(CONFIG.dataEndpoint||url,{cache:"no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let rows;
    if (CONFIG.dataEndpoint) {
      const payload=await response.json(); rows=payload.rows;
      state.cellStatuses=statusesFromBackgrounds(payload.backgrounds||[]);
    } else rows=parseCsv(await response.text());
    if (rows.length<2 || rows[0][0]!=="Month") throw new Error("Unexpected sheet format");
    state.records=normalize(rows); status.classList.add("live"); status.lastElementChild.textContent=CONFIG.dataEndpoint?"Live values + colors":"Live values · colors unavailable";
  } catch (error) {
    state.records=[]; status.classList.add("error"); status.lastElementChild.textContent="Live sheet unavailable";
    console.error("Live Sheet unavailable.",error);
  }
  populateFilters(); render();
}

function statusesFromBackgrounds(backgrounds) {
  const statuses={};
  backgrounds.forEach((row,rowIndex)=>[4,5].forEach(columnIndex=>{
    const color=String(row[columnIndex]||"").toLowerCase();
    const status=color==="#d9ead3"?"green":color==="#ffff00"?"yellow":color==="#ff0000"?"red":"";
    if (status) statuses[`${rowIndex+1}:${columnIndex===4?'E':'F'}`]=status;
  }));
  return statuses;
}

function filtered() {
  const needle=state.search.toLowerCase();
  return state.records.filter(r=>isInWindow(r)&&(!state.team||r.team===state.team)&&(!state.feature||r.type===state.feature)&&(!needle||[r.feature,r.event,r.team,r.comment,r.month].join(" ").toLowerCase().includes(needle))).sort(sortRecords);
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
function isInWindow(record) {
  const month=plannedMonth(record);
  const monthEnd=month&&new Date(month.getFullYear(),month.getMonth()+1,1);
  return overlaps(record.dev)||overlaps(record.prod)||(month&&month<state.rangeEnd&&monthEnd>state.rangeStart)||(!month&&!record.dev&&!record.prod);
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
  const label=missingDateLabel(record);
  if (!label) return '';
  return `<b class="warning" title="${label}" aria-label="${label}">!</b>`;
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
  render();
}

function populateFilters() {
  const add=(selector,values)=>values.sort().forEach(value=>document.querySelector(selector).add(new Option(value,value)));
  add("#teamFilter",[...new Set(state.records.map(r=>r.team))]);
  add("#featureFilter",[...new Set(state.records.map(r=>r.type))]);
}

function formatDate(date) { return date?date.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"Not scheduled"; }
function duration(range) { return range?Math.round((range.end-range.start)/86400000)+1:0; }
function offset(date) { return Math.max(0,Math.min(100,(date-state.rangeStart)/(state.rangeEnd-state.rangeStart)*100)); }
function escapeHtml(value) { const node=document.createElement("div"); node.textContent=value||""; return node.innerHTML; }

function scheduleStatus(record,kind) {
  const range=record[kind], source=record[`${kind}SourceStatus`];
  if (!range) return "missing";
  if (kind==="prod") {
    const devStatus=record.dev?scheduleStatus(record,"dev"):null;
    if (devStatus==="red") return "red";
    if (devStatus==="green") return "green";
    if (devStatus==="yellow") return "yellow";
    return range.start>todayDate ? "scheduled" : "green";
  }
  if (source==="green") return "green";
  if (range.end<todayDate) return "red";
  if (todayDate>=range.start && todayDate<=range.end) return "yellow";
  return "scheduled";
}

function statusLabel(status,kind) {
  if (kind==="prod" && status==="green") return "Production";
  return ({green:"Done",yellow:"Development",red:"Late",scheduled:"Upcoming",missing:"Not scheduled"})[status];
}

function renderMetrics(records) {
  const scheduled=records.filter(r=>r.prod||r.dev).length;
  const ready=records.filter(r=>r.prod&&r.dev).length;
  const incomplete=records.filter(r=>!r.prod||!r.dev).length;
  document.querySelector("#metrics").innerHTML=`<div class="metric"><strong>${records.length}</strong><span>deliverables</span></div><div class="metric"><strong>${scheduled}</strong><span>scheduled</span></div><div class="metric"><strong>${ready}</strong><span>dev + prod</span></div><div class="metric"><strong>${incomplete}</strong><span>needs dates</span></div>`;
}

function scheduleGroups(records) {
  const byFeature=new Map();
  records.filter(r=>overlaps(r.prod)||!r.prod).forEach(record=>{
    const feature=canonicalScheduleFeature(record.feature);
    if (!byFeature.has(feature)) byFeature.set(feature,{feature,records:[]});
    byFeature.get(feature).records.push(record);
  });
  return [...byFeature.values()].map(group=>({
    ...group,
    teams:[...new Set(group.records.map(r=>r.team))].sort(),
    holidays:[...new Set(group.records.map(r=>r.event).filter(Boolean))].sort(),
    firstProd:new Date(Math.min(...group.records.map(r=>r.prod?.start||plannedMonth(r)||state.rangeStart)))
  })).sort((a,b)=>{
    if (state.sortBy==="feature") return a.feature.localeCompare(b.feature);
    if (state.sortBy==="month") return a.firstProd-b.firstProd||a.feature.localeCompare(b.feature);
    if (state.sortBy==="holiday") return (a.holidays[0]||"No holiday").localeCompare(b.holidays[0]||"No holiday")||a.feature.localeCompare(b.feature);
    return a.teams.join(", ").localeCompare(b.teams.join(", "))||a.feature.localeCompare(b.feature);
  });
}

function canonicalScheduleFeature(feature) {
  const normalized=feature.trim().toLowerCase();
  if (normalized.startsWith("stickers")) return "Stickers";
  if (normalized.startsWith("ltd")) return "LTD";
  if (normalized.startsWith("season pass")) return "Season Pass";
  if (normalized.startsWith("sale")) return "Sale";
  return feature.trim();
}

function scheduleBar(record,label,top=16) {
  const left=offset(record.prod.start), width=Math.max(.5,offset(new Date(record.prod.end.getTime()+86400000))-left), status=scheduleStatus(record,"prod");
  const detail=missingDateLabel(record)||`${duration(record.prod)}d`;
  return `<button class="bar prod status-${status}${!record.dev?' needs-planning':''}" data-id="${record.id}" style="left:${left}%;width:${width}%;top:${top}px" title="${escapeHtml(label)} · ${record.prodText} · ${missingDateLabel(record)||statusLabel(status,'prod')}">${escapeHtml(label)} · ${detail} ${planningWarning(record)}</button>`;
}

function scheduleRow(group,line) {
  const laneEnds=[];
  const entries=group.records.map(record=>{
    const month=plannedMonth(record);
    const start=record.prod?.start||month||state.rangeStart;
    const end=record.prod?new Date(record.prod.end.getFullYear(),record.prod.end.getMonth(),record.prod.end.getDate()+1):month?new Date(month.getFullYear(),month.getMonth()+1,1):state.rangeEnd;
    const visible=end>state.rangeStart&&start<state.rangeEnd;
    const left=visible?offset(start):0, width=visible?Math.max(.5,offset(end)-left):100;
    return {record,left,width};
  }).sort((a,b)=>a.left-b.left);
  const bars=entries.map(({record,left,width})=>{
    let lane=laneEnds.findIndex(end=>end<=left);
    if (lane<0) lane=laneEnds.length;
    laneEnds[lane]=left+width;
    const top=16+lane*32;
    if (record.prod) return scheduleBar(record,record.feature,top);
    const description=missingDateLabel(record);
    return `<button class="bar unplanned needs-planning" data-id="${record.id}" style="left:${left}%;width:${width}%;top:${top}px" title="${escapeHtml(record.feature)} · ${escapeHtml(record.month)} · ${description}" aria-label="${escapeHtml(record.feature)} · ${escapeHtml(record.month)} · ${description}">${escapeHtml(record.feature)} · ${description} ${planningWarning(record)}</button>`;
  }).join('');
  const missing=group.records.find(record=>!record.dev||!record.prod);
  const scheduled=group.records.filter(record=>record.prod).length;
  const undated=group.records.length-scheduled;
  const summary=[scheduled?`${scheduled} production window${scheduled===1?'':'s'}`:'',undated?`${undated} without production dates`:''].filter(Boolean).join(' · ');
  return `<div class="timeline-row schedule-row" style="min-height:${Math.max(56,24+laneEnds.length*32)}px"><div class="event-label" data-id="${group.records[0].id}" style="--type-color:${TYPE_COLORS[group.records[0].type]||'#82909a'}"><i class="type-rail"></i><span><strong>${escapeHtml(group.feature)}</strong><small title="${summary}">${summary}</small><small>${escapeHtml(group.teams.join(', '))}</small></span>${missing?`<button class="feature-warning" data-id="${missing.id}" title="${missingDateLabel(missing)} — open feature details" aria-label="${escapeHtml(group.feature)}: ${missingDateLabel(missing)}">!</button>`:''}</div><div class="track">${line}${bars}</div></div>`;
}

function renderSchedule(records) {
  const months=visibleMonths(), today=new Date(), todayVisible=today>=state.rangeStart&&today<state.rangeEnd;
  const line=monthLines()+(todayVisible?`<i class="today-line" style="left:${offset(today)}%"></i>`:"");
  const groups=scheduleGroups(records);
  if (!groups.length) return '<div class="empty-state">No features in this period.</div>';
  return `<div class="timeline" style="${timelineStyle(months)}"><div class="timeline-header"><div>Production feature</div>${months.map(m=>`<div>${m.toLocaleDateString('en-US',{month:'short'})}<br>${m.getFullYear()}</div>`).join("")}</div>${groups.map(group=>scheduleRow(group,line)).join('')}</div>`;
}

function timelineBar(record,range,kind) {
  if (!overlaps(range)) return "";
  const left=offset(range.start), width=Math.max(.5,offset(new Date(range.end.getTime()+86400000))-left);
  const status=scheduleStatus(record,kind);
  return `<button class="bar ${kind} status-${status}" data-id="${record.id}" style="left:${left}%;width:${width}%" title="${statusLabel(status,kind)} · ${kind.toUpperCase()}: ${escapeHtml(kind==='dev'?record.devText:record.prodText)}">${kind==='dev'?'DEV':'PROD'} · ${duration(range)}d</button>`;
}

function dateCell(record,kind) {
  const range=record[kind], status=scheduleStatus(record,kind);
  return range?`${escapeHtml(record[`${kind}Text`])}<br><span class="date-status status-${status}">${statusLabel(status,kind)}</span>`:`<span class="status-missing">${kind==="prod"?"No Prod Date":"No Dev Date"}</span>`;
}

function renderTimeline(records) {
  const today=new Date(), todayVisible=today>=state.rangeStart&&today<state.rangeEnd;
  const line=monthLines()+(todayVisible?`<i class="today-line" style="left:${offset(today)}%"></i>`:"");
  const months=visibleMonths();
  const row=r=>`<div class="timeline-row"><div class="event-label" data-id="${r.id}" style="--type-color:${TYPE_COLORS[r.type]||'#82909a'}"><i class="type-rail"></i><span><strong>${escapeHtml(r.feature)}</strong><small>${escapeHtml(r.month)} · ${escapeHtml(r.event||'No theme')}</small><b class="event-team">${escapeHtml(r.team)}</b></span>${planningWarning(r)}</div><div class="track">${line}${state.showDev?timelineBar(r,r.dev,"dev"):''}${state.showProd?timelineBar(r,r.prod,"prod"):''}</div></div>`;
  return `<div class="timeline" style="${timelineStyle(months)}"><div class="timeline-header"><div>Feature</div>${months.map(m=>`<div>${m.toLocaleDateString('en-US',{month:'short'})}<br>${m.getFullYear()}</div>`).join("")}</div>${grouped(records).map(group=>`<div class="timeline-group"><strong>${escapeHtml(group.name)} · ${group.records.length}</strong><span></span></div>${group.records.map(row).join("")}`).join("")}</div>`;
}

function renderList(records) {
  const columns=3+Number(state.showDev)+Number(state.showProd);
  const body=grouped(records).map(group=>`<tr class="month-group"><td colspan="${columns}">${escapeHtml(group.name)} · ${group.records.length}</td></tr>${group.records.map(r=>`<tr data-id="${r.id}"><td>${planningWarning(r)} <strong>${escapeHtml(r.feature)}</strong><br><small>${escapeHtml(r.month)} · ${escapeHtml(r.team)}</small></td><td>${escapeHtml(r.event)||'—'}</td>${state.showDev?`<td>${dateCell(r,'dev')}</td>`:''}${state.showProd?`<td>${dateCell(r,'prod')}</td>`:''}<td>${r.dev&&r.prod?'<span class="status-check">✓ Complete</span>':`<span class="status-missing">! ${missingDateLabel(r)}</span>`}</td></tr>`).join("")}`).join("");
  return `<table class="list-view"><thead><tr><th>Feature</th><th>Event</th>${state.showDev?'<th>Development</th>':''}${state.showProd?'<th>Production</th>':''}<th>Coverage</th></tr></thead><tbody>${body}</tbody></table>`;
}

function render() {
  const records=filtered(); renderMetrics(records);
  document.querySelector("#rangeLabel").textContent=`${formatDate(state.rangeStart)} — ${formatDate(new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),state.rangeEnd.getDate()-1))}`;
  const shell=document.querySelector("#calendarShell");
  shell.innerHTML=records.length?(state.view==="schedule"?renderSchedule(records):state.view==="timeline"?renderTimeline(records):renderList(records)):'<div class="empty-state">No events match these filters.</div>';
  shell.querySelectorAll("[data-id]").forEach(el=>el.addEventListener("click",event=>{ event.stopPropagation(); openDetail(Number(el.dataset.id)); }));
}

function openDetail(id) {
  const r=state.records.find(item=>item.id===id); if (!r) return;
  document.querySelector("#dialogContent").innerHTML=`<div class="dialog-body"><p class="eyebrow">${escapeHtml(r.month)} · ${escapeHtml(r.type)}</p><h2>${planningWarning(r)} ${escapeHtml(r.feature)}</h2><div class="team">${escapeHtml(r.event||"No event specified")} · ${escapeHtml(r.team)}</div><div class="detail-grid"><div class="detail-box"><span>Development</span><strong>${r.dev?`${formatDate(r.dev.start)} — ${formatDate(r.dev.end)}`:"No Dev Date"}</strong></div><div class="detail-box"><span>Production</span><strong>${r.prod?`${formatDate(r.prod.start)} — ${formatDate(r.prod.end)}`:"No Prod Date"}</strong></div></div><div class="comment">${escapeHtml(r.comment)||"No description provided."}</div><a class="sheet-cell-link" href="https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/edit#gid=${CONFIG.gid}&amp;range=C${r.sheetRow}" target="_blank" rel="noopener noreferrer">Open feature in Google Sheets ↗</a></div>`;
  document.querySelector("#detailDialog").showModal();
}

document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{ document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===button)); state.view=button.dataset.view; render(); }));
document.querySelector("#searchInput").addEventListener("input",event=>{ state.search=event.target.value; render(); });
document.querySelector("#teamFilter").addEventListener("change",event=>{ state.team=event.target.value; render(); });
document.querySelector("#featureFilter").addEventListener("change",event=>{ state.feature=event.target.value; render(); });
document.querySelector("#showDev").addEventListener("change",event=>{ state.showDev=event.target.checked; render(); });
document.querySelector("#showProd").addEventListener("change",event=>{ state.showProd=event.target.checked; render(); });
document.querySelector("#sortFilter").addEventListener("change",event=>{ state.sortBy=event.target.value; render(); });
document.querySelector('#rangeStart').value=inputDate(state.rangeStart);
document.querySelector('#rangeEnd').value=inputDate(new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),0));
document.querySelector('#rangeStart').addEventListener('change',updateDateRange);
document.querySelector('#rangeEnd').addEventListener('change',updateDateRange);
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
  if (event.key==='Escape'&&!document.querySelector('#dateCalendar').hidden) { event.preventDefault(); closeCalendar(true); }
});
window.addEventListener('resize',()=>closeCalendar());
window.addEventListener('scroll',event=>{ if (!document.querySelector('#dateCalendar').contains(event.target)) closeCalendar(); },true);
document.querySelector(".dialog-close").addEventListener("click",()=>document.querySelector("#detailDialog").close());
document.querySelector("#detailDialog").addEventListener("click",event=>{ if(event.target===event.currentTarget) event.currentTarget.close(); });

loadData();
