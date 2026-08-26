const now = new Date();
const todayDate = new Date(now.getFullYear(),now.getMonth(),now.getDate());
const cycleYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear()-1;
const CONFIG = {
  spreadsheetId: "1wWJXhI2wvO_BQlzvSZRov1deL7FLMMFPlqAV9dDHeqA",
  gid: "1371010002",
  cycleStart: new Date(cycleYear, 7, 1),
  cycleEnd: new Date(cycleYear+1, 7, 1)
};

const TYPE_COLORS = { Sale:"#d07858", Stickers:"#a86d9e", "Season Pass":"#547baa", LTD:"#c39335", Adventure:"#3f8d81", Expedition:"#7b6fa8" };
const state = { records: [], view:"schedule", search:"", team:"", feature:"", sortBy:"team", showDev:true, showProd:true, windowMonths:6, rangeStart:new Date(now.getFullYear(),now.getMonth(),1), rangeEnd:new Date(now.getFullYear(),now.getMonth()+6,1) };

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
    const prodText=(row[4]||"").trim(), devText=(row[5]||"").trim(), statuses=window.LIVEOPS_CELL_STATUS||{};
    return { id:index, sheetRow, month, event, feature, type, title:feature, team:(row[3]||"Unassigned").trim()||"Unassigned", prodText, devText, comment:(row[6]||"").trim(), prod:parseRange(prodText), dev:parseRange(devText), prodSourceStatus:statuses[`${sheetRow}:E`]||statuses[`${feature}|${prodText}:E`]||"", devSourceStatus:statuses[`${sheetRow}:F`]||statuses[`${feature}|${devText}:F`]||"" };
  }).filter(Boolean);
}

async function loadData() {
  const status=document.querySelector("#syncStatus");
  const url=`https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}`;
  try {
    const response=await fetch(url,{cache:"no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows=parseCsv(await response.text());
    if (rows.length<2 || rows[0][0]!=="Month") throw new Error("Unexpected sheet format");
    state.records=normalize(rows); status.classList.add("live"); status.lastElementChild.textContent="Live sheet connected";
  } catch (error) {
    state.records=normalize(window.LIVEOPS_SNAPSHOT||[]); status.classList.add("error"); status.lastElementChild.textContent="Snapshot · live access unavailable";
    console.info("Live Sheet unavailable; using bundled snapshot.",error);
  }
  populateFilters(); render();
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
  return overlaps(record.dev)||overlaps(record.prod)||(month&&month>=state.rangeStart&&month<state.rangeEnd);
}

function visibleMonths() {
  return Array.from({length:state.windowMonths},(_,i)=>new Date(state.rangeStart.getFullYear(),state.rangeStart.getMonth()+i,1));
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
  records.filter(r=>overlaps(r.prod)).forEach(record=>{
    const feature=record.feature.toLowerCase().startsWith("stickers")?"Stickers":record.feature;
    if (!byFeature.has(feature)) byFeature.set(feature,{feature,records:[]});
    byFeature.get(feature).records.push(record);
  });
  return [...byFeature.values()].map(group=>({
    ...group,
    teams:[...new Set(group.records.map(r=>r.team))].sort(),
    holidays:[...new Set(group.records.map(r=>r.event).filter(Boolean))].sort(),
    firstProd:new Date(Math.min(...group.records.map(r=>r.prod.start)))
  })).sort((a,b)=>{
    if (state.sortBy==="feature") return a.feature.localeCompare(b.feature);
    if (state.sortBy==="month") return a.firstProd-b.firstProd||a.feature.localeCompare(b.feature);
    if (state.sortBy==="holiday") return (a.holidays[0]||"No holiday").localeCompare(b.holidays[0]||"No holiday")||a.feature.localeCompare(b.feature);
    return a.teams.join(", ").localeCompare(b.teams.join(", "))||a.feature.localeCompare(b.feature);
  });
}

function scheduleBar(record) {
  const left=offset(record.prod.start), width=Math.max(.5,offset(new Date(record.prod.end.getTime()+86400000))-left), status=scheduleStatus(record,"prod");
  return `<button class="bar prod status-${status}" data-id="${record.id}" style="left:${left}%;width:${width}%" title="${escapeHtml(record.event||record.feature)} · ${record.prodText}">${escapeHtml(record.event||"PROD")} · ${duration(record.prod)}d</button>`;
}

function renderSchedule(records) {
  const months=visibleMonths(), today=new Date(), todayVisible=today>=state.rangeStart&&today<state.rangeEnd;
  const line=todayVisible?`<i class="today-line" style="left:${offset(today)}%"></i>`:"";
  const groups=scheduleGroups(records);
  if (!groups.length) return '<div class="empty-state">No production windows in this period.</div>';
  return `<div class="timeline" style="--month-count:${months.length}"><div class="timeline-header"><div>Production feature</div>${months.map(m=>`<div>${m.toLocaleDateString('en-US',{month:'short'})}<br>${m.getFullYear()}</div>`).join("")}</div>${groups.map(group=>`<div class="timeline-row schedule-row"><div class="event-label" data-id="${group.records[0].id}" style="--type-color:${TYPE_COLORS[group.records[0].type]||'#82909a'}"><i class="type-rail"></i><span><strong>${escapeHtml(group.feature)}</strong><small>${group.records.length} production window${group.records.length===1?'':'s'} · ${escapeHtml(group.teams.join(', '))}</small></span></div><div class="track">${line}${group.records.map(scheduleBar).join("")}</div></div>`).join("")}</div>`;
}

function timelineBar(record,range,kind) {
  if (!range) return "";
  const left=offset(range.start), width=Math.max(.5,offset(new Date(range.end.getTime()+86400000))-left);
  const status=scheduleStatus(record,kind);
  return `<button class="bar ${kind} status-${status}" data-id="${record.id}" style="left:${left}%;width:${width}%" title="${statusLabel(status,kind)} · ${kind.toUpperCase()}: ${escapeHtml(kind==='dev'?record.devText:record.prodText)}">${kind==='dev'?'DEV':'PROD'} · ${duration(range)}d</button>`;
}

function dateCell(record,kind) {
  const range=record[kind], status=scheduleStatus(record,kind);
  return range?`${escapeHtml(record[`${kind}Text`])}<br><span class="date-status status-${status}">${statusLabel(status,kind)}</span>`:'<span class="status-missing">Not scheduled</span>';
}

function renderTimeline(records) {
  const today=new Date(), todayVisible=today>=state.rangeStart&&today<state.rangeEnd;
  const line=todayVisible?`<i class="today-line" style="left:${offset(today)}%"></i>`:"";
  const months=visibleMonths();
  const row=r=>`<div class="timeline-row"><div class="event-label" data-id="${r.id}" style="--type-color:${TYPE_COLORS[r.type]||'#82909a'}"><i class="type-rail"></i><span><strong>${escapeHtml(r.feature)}</strong><small>${escapeHtml(r.month)} · ${escapeHtml(r.event||'No theme')}</small><b class="event-team">${escapeHtml(r.team)}</b></span>${(!r.dev||!r.prod)?'<b class="warning" title="Schedule incomplete">!</b>':''}</div><div class="track">${line}${state.showDev?timelineBar(r,r.dev,"dev"):''}${state.showProd?timelineBar(r,r.prod,"prod"):''}</div></div>`;
  return `<div class="timeline" style="--month-count:${months.length}"><div class="timeline-header"><div>Feature</div>${months.map(m=>`<div>${m.toLocaleDateString('en-US',{month:'short'})}<br>${m.getFullYear()}</div>`).join("")}</div>${grouped(records).map(group=>`<div class="timeline-group"><strong>${escapeHtml(group.name)} · ${group.records.length}</strong><span></span></div>${group.records.map(row).join("")}`).join("")}</div>`;
}

function renderList(records) {
  const columns=3+Number(state.showDev)+Number(state.showProd);
  const body=grouped(records).map(group=>`<tr class="month-group"><td colspan="${columns}">${escapeHtml(group.name)} · ${group.records.length}</td></tr>${group.records.map(r=>`<tr data-id="${r.id}"><td><strong>${escapeHtml(r.feature)}</strong><br><small>${escapeHtml(r.month)} · ${escapeHtml(r.team)}</small></td><td>${escapeHtml(r.event)||'—'}</td>${state.showDev?`<td>${dateCell(r,'dev')}</td>`:''}${state.showProd?`<td>${dateCell(r,'prod')}</td>`:''}<td>${r.dev&&r.prod?'<span class="status-check">✓ Complete</span>':'<span class="status-missing">! Needs dates</span>'}</td></tr>`).join("")}`).join("");
  return `<table class="list-view"><thead><tr><th>Feature</th><th>Event</th>${state.showDev?'<th>Development</th>':''}${state.showProd?'<th>Production</th>':''}<th>Coverage</th></tr></thead><tbody>${body}</tbody></table>`;
}

function render() {
  const records=filtered(); renderMetrics(records);
  document.querySelector("#rangeLabel").textContent=`${state.rangeStart.toLocaleDateString('en-US',{month:'short',year:'numeric'})} — ${new Date(state.rangeEnd.getTime()-86400000).toLocaleDateString('en-US',{month:'short',year:'numeric'})}`;
  const shell=document.querySelector("#calendarShell");
  shell.innerHTML=records.length?(state.view==="schedule"?renderSchedule(records):state.view==="timeline"?renderTimeline(records):renderList(records)):'<div class="empty-state">No events match these filters.</div>';
  shell.querySelectorAll("[data-id]").forEach(el=>el.addEventListener("click",event=>{ event.stopPropagation(); openDetail(Number(el.dataset.id)); }));
}

function openDetail(id) {
  const r=state.records.find(item=>item.id===id); if (!r) return;
  document.querySelector("#dialogContent").innerHTML=`<div class="dialog-body"><p class="eyebrow">${escapeHtml(r.month)} · ${escapeHtml(r.type)}</p><h2>${escapeHtml(r.feature)}</h2><div class="team">${escapeHtml(r.event||"No event specified")} · ${escapeHtml(r.team)}</div><div class="detail-grid"><div class="detail-box"><span>Development</span><strong>${r.dev?`${formatDate(r.dev.start)} — ${formatDate(r.dev.end)}`:"Not scheduled"}</strong></div><div class="detail-box"><span>Production</span><strong>${r.prod?`${formatDate(r.prod.start)} — ${formatDate(r.prod.end)}`:"Not scheduled"}</strong></div></div><div class="comment">${escapeHtml(r.comment)||"No description provided."}</div></div>`;
  document.querySelector("#detailDialog").showModal();
}

document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{ document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===button)); state.view=button.dataset.view; render(); }));
document.querySelector("#searchInput").addEventListener("input",event=>{ state.search=event.target.value; render(); });
document.querySelector("#teamFilter").addEventListener("change",event=>{ state.team=event.target.value; render(); });
document.querySelector("#featureFilter").addEventListener("change",event=>{ state.feature=event.target.value; render(); });
document.querySelector("#showDev").addEventListener("change",event=>{ state.showDev=event.target.checked; render(); });
document.querySelector("#showProd").addEventListener("change",event=>{ state.showProd=event.target.checked; render(); });
document.querySelector("#sortFilter").addEventListener("change",event=>{ state.sortBy=event.target.value; render(); });
document.querySelector("#windowFilter").addEventListener("change",event=>{ state.windowMonths=Number(event.target.value); state.rangeStart=new Date(now.getFullYear(),now.getMonth(),1); state.rangeEnd=new Date(now.getFullYear(),now.getMonth()+state.windowMonths,1); render(); });
document.querySelector("#todayButton").addEventListener("click",()=>{ const shell=document.querySelector("#calendarShell"), line=shell.querySelector(".today-line"); if(line) shell.scrollTo({left:Math.max(0,line.offsetLeft-shell.clientWidth/2),behavior:"smooth"}); });
document.querySelector(".dialog-close").addEventListener("click",()=>document.querySelector("#detailDialog").close());
document.querySelector("#detailDialog").addEventListener("click",event=>{ if(event.target===event.currentTarget) event.currentTarget.close(); });

loadData();
