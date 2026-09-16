function trackColor(track) {
  const colors=['#547baa','#3f8d81','#a86d9e','#c39335','#7b6fa8','#d07858'];
  const hash=Array.from(track).reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return colors[hash%colors.length];
}

function placeholderRange(record) {
  const month=plannedMonth(record);
  return month?{start:month,end:new Date(month.getFullYear(),month.getMonth()+1,0)}:{start:state.rangeStart,end:new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),state.rangeEnd.getDate()-1)};
}

function scheduleEntries(record) {
  const entries=[];
  if (state.showProd) {
    const range=record.prod||placeholderRange(record);
    if (overlaps(range)) entries.push({record,range,kind:record.prod?'prod':'missing'});
  }
  if (record.dev&&state.showDev&&activeToday(record.dev)&&scheduleStatus(record,'dev')==='yellow'&&overlaps(record.dev)) entries.push({record,range:record.dev,kind:'dev'});
  if (record.dev&&state.showLate&&record.prodSourceStatus!=='green'&&scheduleStatus(record,'dev')==='red'&&overlaps(record.dev)) entries.push({record,range:record.dev,kind:'dev'});
  if (record.dev&&state.showPlanned&&record.dev.start>todayDate&&scheduleStatus(record,'dev')==='scheduled'&&overlaps(record.dev)) entries.push({record,range:record.dev,kind:'dev'});
  if (!record.dev&&state.showEstimates&&overlaps(record.estimatedDev)) entries.push({record,range:record.estimatedDev,kind:'dev'});
  return entries;
}

function scheduleGroups(records) {
  const groups=new Map();
  records.forEach(record=>{
    const entries=scheduleEntries(record);
    if (!entries.length) return;
    const key=record.track?`track:${record.track}`:`feature:${record.id}`;
    if (!groups.has(key)) groups.set(key,{track:record.track||record.feature,records:[],entries:[]});
    groups.get(key).records.push(record);
    groups.get(key).entries.push(...entries);
  });
  return [...groups.values()].map(group=>({...group,teams:[...new Set(group.records.map(record=>record.team))].sort()})).sort((a,b)=>{
    if (state.sortBy==='month') return Math.min(...a.entries.map(entry=>entry.range.start))-Math.min(...b.entries.map(entry=>entry.range.start))||a.track.localeCompare(b.track);
    if (state.sortBy==='team') return a.teams.join(', ').localeCompare(b.teams.join(', '))||a.track.localeCompare(b.track);
    if (state.sortBy==='holiday') return (a.records[0].event||'').localeCompare(b.records[0].event||'')||a.track.localeCompare(b.track);
    return a.track.localeCompare(b.track);
  });
}

function barGeometry(range) {
  const left=offset(range.start), end=new Date(range.end.getFullYear(),range.end.getMonth(),range.end.getDate()+1);
  return {left,width:Math.max(.5,offset(end)-left)};
}

function phaseName(kind) { return kind==='dev'?'Development':'Production'; }

function phaseStatusLabel(record,kind) {
  const status=scheduleStatus(record,kind);
  if (status!=='red') return statusLabel(status);
  return kind==='dev'||(record.prodSourceStatus!=='red'&&scheduleStatus(record,'dev')==='red')?'Late dev':'Late production';
}

function lateFeatureAlerts(records) {
  return records.flatMap(record=>{
    if (record.prodSourceStatus==='green') return [];
    const phases=[];
    if (scheduleStatus(record,'dev')==='red') phases.push({kind:'dev',range:developmentRange(record)});
    if (record.prod&&record.prodSourceStatus==='red') phases.push({kind:'prod',range:record.prod});
    return phases.length?[{record,phases}]:[];
  });
}

function featureBar(record,range,kind,top,overlay=false) {
  const {left,width}=barGeometry(range);
  const status=kind==='missing'?'missing':scheduleStatus(record,kind);
  const estimated=kind==='dev'&&!record.dev;
  const warnings=recordWarnings(record);
  const caption=kind==='missing'?`${record.feature} · ${missingDateLabel(record)}`:`${kind==='dev'?'DEV · ':''}${record.feature}${estimated?' · Estimated':''}`;
  const label=`${record.feature} · ${phaseName(kind)} · ${kind==='missing'?statusLabel(status):phaseStatusLabel(record,kind)}${estimated?' · Estimated dates':''}`;
  return `<button class="bar ${kind==='missing'?'unplanned':kind} status-${status}${overlay?' dev-overlay':''}${estimated?' estimated':''}${warnings.length?' needs-planning':''}" data-id="${record.id}" data-kind="${kind}" style="left:${left}%;width:${width}%;top:${top}px" aria-label="${escapeHtml(label)}">${statusIcon(status)}<span class="bar-label">${escapeHtml(caption)}</span>${warnings.length?planningWarning(record):''}</button>`;
}

const SCHEDULE_LANE_STEP=55;

function simplifyConnectorPoints(points) {
  const result=[];
  for (const point of points) {
    if (result.at(-1)?.x===point.x&&result.at(-1)?.y===point.y) continue;
    while (result.length>1) {
      const a=result.at(-2),b=result.at(-1);
      if (!((a.x===b.x&&b.x===point.x)||(a.y===b.y&&b.y===point.y))) break;
      result.pop();
    }
    if (result.at(-1)?.x!==point.x||result.at(-1)?.y!==point.y) result.push(point);
  }
  return result;
}

function connectorRoute(dev,prod,entries,occupied=[]) {
  if (dev.top===prod.top) {
    const forward=dev.left+dev.width<=prod.left;
    const backward=prod.left+prod.width<=dev.left;
    if (forward||backward) {
      const a={x:(forward?dev.left+dev.width:dev.left)*10,y:dev.top+12.5};
      const b={x:(forward?prod.left:prod.left+prod.width)*10,y:prod.top+12.5};
      const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x);
      const blocked=entries.some(entry=>entry!==dev&&entry!==prod&&a.y>entry.top&&a.y<entry.top+25&&entry.left*10<right&&(entry.left+entry.width)*10>left);
      const shared=occupied.some(segment=>segment.a.y===segment.b.y&&Math.abs(segment.a.y-a.y)<6&&Math.min(segment.a.x,segment.b.x)<right&&Math.max(segment.a.x,segment.b.x)>left);
      if (!blocked&&!shared) return [a,b];
    }
  }
  const fromX=(dev.left+dev.width)*10-Math.min(6,dev.width*5);
  const toX=prod.left*10+Math.min(6,prod.width*5);
  const tops=[...new Set(entries.map(entry=>entry.top))].sort((a,b)=>a-b);
  const gutters=new Map(tops.map((top,i)=>[top,top+25+((tops[i+1]??top+SCHEDULE_LANE_STEP)-top-25)/2]));
  const enterFromAbove=dev.top<prod.top;
  const leaveFromAbove=dev.top>prod.top;
  const fromY=gutters.get(leaveFromAbove?tops[tops.indexOf(dev.top)-1]:dev.top), toY=gutters.get(enterFromAbove?tops[tops.indexOf(prod.top)-1]:prod.top);
  const sourceY=dev.top+(leaveFromAbove?0:25);
  const targetY=prod.top+(enterFromAbove?0:25);
  const xs=[...new Set([fromX,toX,fromX-8,fromX+8,toX-8,toX+8,1,999,...entries.flatMap(entry=>[entry.left*10-4,entry.left*10-12,(entry.left+entry.width)*10+4,(entry.left+entry.width)*10+12])].filter(x=>x>=0&&x<=1000))].sort((a,b)=>a-b);
  const ys=[...new Set(tops.flatMap((top,i)=>{
    const gap=(tops[i+1]??top+SCHEDULE_LANE_STEP)-top-25;
    return gap>=26?[top+32,gutters.get(top),top+25+gap-7]:[gutters.get(top)];
  }))].sort((a,b)=>a-b);
  const width=xs.length, start=ys.indexOf(fromY)*width+xs.indexOf(fromX), goal=ys.indexOf(toY)*width+xs.indexOf(toX);
  const point=id=>({x:xs[id%width],y:ys[Math.floor(id/width)]});
  const costs=new Map([[start,0]]), previous=new Map(), open=new Set([start]);
  const heuristic=id=>{const p=point(id);return Math.abs(p.x-toX)+Math.abs(p.y-toY);};
  // Horizontal edges stay in the gaps between lanes. Vertical edges are
  // admitted only where they do not cross any feature box.
  while (open.size) {
    let current;
    for (const id of open) if (current===undefined||costs.get(id)+heuristic(id)<costs.get(current)+heuristic(current)) current=id;
    if (current===goal) {
      const points=[];
      for (let id=goal;id!==undefined;id=previous.get(id)) points.unshift(point(id));
      // Include box anchors before simplification: the last routing channel
      // can otherwise overshoot the endpoint and double back into a hook.
      return simplifyConnectorPoints([{x:fromX,y:sourceY},...points,{x:toX,y:targetY}]);
    }
    open.delete(current);
    const p=point(current), column=current%width, row=Math.floor(current/width);
    const neighbors=[column>0?current-1:null,column<width-1?current+1:null,row>0?current-width:null,row<ys.length-1?current+width:null].filter(id=>id!==null);
    for (const neighbor of neighbors) {
      const next=point(neighbor);
      if (p.y!==next.y&&entries.some(entry=>p.x>entry.left*10-2&&p.x<(entry.left+entry.width)*10+2&&Math.min(p.y,next.y)<entry.top+27&&Math.max(p.y,next.y)>entry.top-2)) continue;
      let sharingCost=0;
      for (const segment of occupied) {
        const horizontal=p.y===next.y&&segment.a.y===segment.b.y&&Math.abs(p.y-segment.a.y)<6;
        const vertical=p.x===next.x&&segment.a.x===segment.b.x&&Math.abs(p.x-segment.a.x)<6;
        if (!horizontal&&!vertical) continue;
        const axis=horizontal?'x':'y';
        const shared=Math.min(Math.max(p[axis],next[axis]),Math.max(segment.a[axis],segment.b[axis]))-Math.max(Math.min(p[axis],next[axis]),Math.min(segment.a[axis],segment.b[axis]));
        if (shared>0) sharingCost+=shared*60+20;
      }
      // Crossing is allowed. Running alongside an occupied segment is costly,
      // so later connections choose another channel whenever one is available.
      const cost=costs.get(current)+Math.abs(next.x-p.x)+Math.abs(next.y-p.y)+sharingCost;
      if (cost>=(costs.get(neighbor)??Infinity)) continue;
      costs.set(neighbor,cost); previous.set(neighbor,current); open.add(neighbor);
    }
  }
  return [];
}

function roundedConnectorPath(points) {
  points=simplifyConnectorPoints(points);
  if (!points.length) return '';
  let path=`M ${points[0].x} ${points[0].y}`;
  for (let i=1;i<points.length-1;i++) {
    const before=points[i-1],corner=points[i],after=points[i+1];
    const incoming=Math.hypot(corner.x-before.x,corner.y-before.y), outgoing=Math.hypot(after.x-corner.x,after.y-corner.y);
    if (!incoming||!outgoing) continue;
    const radius=Math.min(6,incoming/2,outgoing/2);
    const entry={x:corner.x+(before.x-corner.x)*radius/incoming,y:corner.y+(before.y-corner.y)*radius/incoming};
    const exit={x:corner.x+(after.x-corner.x)*radius/outgoing,y:corner.y+(after.y-corner.y)*radius/outgoing};
    path+=` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const end=points.at(-1);
  return path+` L ${end.x} ${end.y}`;
}

function scheduleConnections(entries) {
  const occupied=[];
  return entries.filter(entry=>entry.kind==='dev').flatMap(dev=>{
    const prod=entries.find(entry=>entry.record.id===dev.record.id&&(entry.kind==='prod'||entry.kind==='missing'));
    if (!prod) return [];
    const points=connectorRoute(dev,prod,entries,occupied);
    if (!points.length) return [];
    points.slice(1).forEach((point,i)=>occupied.push({a:points[i],b:point}));
    return [{dev,prod,points}];
  });
}

function developmentConnectors(entries,height,connections=scheduleConnections(entries)) {
  const paths=connections.map(({dev,prod,points})=>{
    const end=points.at(-1);
    const before=points.at(-2);
    const endX=end.x+Math.sign(before.x-end.x)*1.5;
    const endY=end.y+Math.sign(before.y-end.y)*1.5;
    const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
    const path=roundedConnectorPath(points);
    return `<g class="phase-connector dev-status-${scheduleStatus(dev.record,'dev')}${!dev.record.dev?' estimated':''}${length<32?' short-connection':''}" data-feature-id="${dev.record.id}"><path class="connector-halo" d="${path}"/><path class="connector-stroke" d="${path}"/><circle class="connector-end" cx="${endX}" cy="${endY}" r="1.5"/></g>`;
  }).join('');
  if (!paths) return '';
  return `<svg class="phase-connectors" style="height:${height}px" viewBox="0 0 1000 ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${paths}</svg>`;
}

function scheduleRow(group,line) {
  const laneEnds=[];
  const entries=group.entries.map(entry=>({...entry,...barGeometry(entry.range)})).sort((a,b)=>a.left-b.left||a.kind.localeCompare(b.kind)).map(entry=>{
    let lane=laneEnds.findIndex(end=>end<=entry.left);
    if (lane<0) lane=laneEnds.length;
    laneEnds[lane]=entry.left+entry.width;
    return {...entry,top:14+lane*SCHEDULE_LANE_STEP};
  });
  const bars=entries.map(entry=>featureBar(entry.record,entry.range,entry.kind,entry.top,entry.kind==='dev')).join('');
  const connections=scheduleConnections(entries);
  const height=Math.max(62,...entries.map(entry=>entry.top+25+14),...connections.flatMap(connection=>connection.points.map(point=>point.y+12)));
  const connectors=developmentConnectors(entries,height-1,connections);
  const warning=group.records.find(record=>recordWarnings(record).length);
  return `<div class="timeline-row schedule-row" style="min-height:${height}px"><div class="event-label" style="--type-color:${trackColor(group.track)}"><i class="type-rail"></i><span><strong>${escapeHtml(group.track)}</strong><small>${group.records.length} feature${group.records.length===1?'':'s'}</small><small>${escapeHtml(group.teams.join(', '))}</small></span>${warning?`<button class="feature-warning" data-id="${warning.id}" title="${escapeHtml(recordWarnings(warning).join(' · '))}" aria-label="${escapeHtml(group.track)}: review warnings">!</button>`:''}</div><div class="track">${line}${connectors}${bars}</div></div>`;
}

function timelineHeader(months,label) {
  return `<div class="timeline-header"><div>${label}</div>${months.map(month=>`<div>${month.toLocaleDateString('en-US',{month:'short'})}<br>${month.getFullYear()}</div>`).join('')}</div>`;
}

function timelineLines() {
  return monthLines()+(todayDate>=state.rangeStart&&todayDate<state.rangeEnd?`<i class="today-line" style="left:${offset(todayDate)}%"></i>`:'');
}

function renderSchedule(records) {
  const months=visibleMonths(), groups=scheduleGroups(records), line=timelineLines();
  if (!groups.length) return '<div class="empty-state">No visible windows. Try another date range or enable a timeline layer.</div>';
  return `<div class="timeline" style="${timelineStyle(months)}">${timelineHeader(months,'Track')}${groups.map(group=>scheduleRow(group,line)).join('')}</div>`;
}

function renderTimeline(records) {
  const months=visibleMonths(), line=timelineLines();
  const row=record=>{
    const dev=developmentRange(record);
    const showDev=state.showDev&&dev&&(record.dev||state.showEstimates)&&overlaps(dev);
    return `<div class="timeline-row"><div class="event-label" data-id="${record.id}" style="--type-color:${trackColor(record.track||record.feature)}"><i class="type-rail"></i><span><strong>${escapeHtml(record.feature)}</strong><small>${escapeHtml(record.track||'No track')} · ${escapeHtml(record.month)}</small><b class="event-team">${escapeHtml(record.team)}</b></span>${planningWarning(record)}</div><div class="track">${line}${showDev?featureBar(record,dev,'dev',7,true):''}${state.showProd&&overlaps(record.prod)?featureBar(record,record.prod,'prod',37):''}</div></div>`;
  };
  return `<div class="timeline" style="${timelineStyle(months)}">${timelineHeader(months,'Feature')}${grouped(records).map(group=>`<div class="timeline-group"><strong>${escapeHtml(group.name)} · ${group.records.length}</strong><span></span></div>${group.records.map(row).join('')}`).join('')}</div>`;
}

function dateCell(record,kind) {
  const range=kind==='dev'?developmentRange(record):record.prod, status=scheduleStatus(record,kind);
  const estimated=kind==='dev'&&!record.dev&&range;
  return range?`${escapeHtml(estimated?`${formatDate(range.start)} — ${formatDate(range.end)}`:record[`${kind}Text`])}${estimated?'<small class="estimate-note">! Estimated dates</small>':''}<br><span class="date-status status-${status}">${statusIcon(status)} ${phaseStatusLabel(record,kind)}</span>`:`<span class="status-missing">! ${kind==='prod'?'No Prod Date':'No Dev Date'}</span>`;
}

function renderList(records) {
  const columns=3+Number(state.showDev)+Number(state.showProd);
  const body=grouped(records).map(group=>`<tr class="month-group"><td colspan="${columns}">${escapeHtml(group.name)} · ${group.records.length}</td></tr>${group.records.map(record=>`<tr data-id="${record.id}"><td>${planningWarning(record)} <strong>${escapeHtml(record.feature)}</strong><br><small>${escapeHtml(record.track||'No track')} · ${escapeHtml(record.team)}</small></td><td>${escapeHtml(record.event)||'—'}</td>${state.showDev?`<td>${dateCell(record,'dev')}</td>`:''}${state.showProd?`<td>${dateCell(record,'prod')}</td>`:''}<td>${recordWarnings(record).map(warning=>`<div class="status-missing">! ${escapeHtml(warning)}</div>`).join('')||'<span class="status-complete">✓ Dates entered</span>'}</td></tr>`).join('')}`).join('');
  return `<table class="list-view"><thead><tr><th>Feature / Track</th><th>Event</th>${state.showDev?'<th>Development</th>':''}${state.showProd?'<th>Production</th>':''}<th>Warnings</th></tr></thead><tbody>${body}</tbody></table>`;
}

function conflictDescription(conflict) {
  return `${phaseName(conflict.phaseA)} / ${phaseName(conflict.phaseB)} · ${formatDate(conflict.start)} — ${formatDate(conflict.end)}${conflict.estimated?' · includes estimated dates':''}`;
}

function renderAlerts(records) {
  const ids=new Set(records.map(record=>record.id));
  const conflicts=state.conflicts.filter(conflict=>overlaps(conflict)&&(ids.has(conflict.a.id)||ids.has(conflict.b.id)));
  const late=lateFeatureAlerts(records);
  const panel=document.querySelector('#teamAlerts');
  const expanded=panel.querySelector('details')?.open||false;
  const counts=[late.length?`${late.length} late feature${late.length===1?'':'s'}`:'',conflicts.length?`${conflicts.length} team overlap${conflicts.length===1?'':'s'}`:''].filter(Boolean).join(' · ');
  const lateRows=late.map(({record,phases})=>`<div class="conflict-item"><strong>${escapeHtml(record.team)}</strong><div><button data-id="${record.id}">${escapeHtml(record.feature)} (${escapeHtml(record.month)})</button>${phases.map(({kind,range})=>`<small>${kind==='dev'?'Late dev':'Late production'}${kind==='dev'&&!record.dev?' · Estimated':''} · ${formatDate(range.start)} — ${formatDate(range.end)}</small>`).join('')}</div></div>`).join('');
  const overlapRows=conflicts.map(conflict=>`<div class="conflict-item"><strong>${escapeHtml(conflict.a.team)}</strong><div><button data-id="${conflict.a.id}">${escapeHtml(conflict.a.feature)} (${escapeHtml(conflict.a.month)})</button><span> overlaps </span><button data-id="${conflict.b.id}">${escapeHtml(conflict.b.feature)} (${escapeHtml(conflict.b.month)})</button><small>${escapeHtml(conflictDescription(conflict))}</small></div></div>`).join('');
  panel.innerHTML=counts?`<details ${expanded?'open':''}><summary><span class="warning">!</span> ${counts} in this date range <span class="alert-hint">Review alerts</span></summary><div class="conflict-list">${late.length?'<h3>Late features</h3>':''}${lateRows}${conflicts.length?'<h3>Team overlaps</h3>':''}${overlapRows}</div></details>`:'';
  panel.hidden=!counts;
}

function hideTooltip() {
  document.querySelector('#featureTooltip').hidden=true;
  document.querySelectorAll('[aria-describedby="featureTooltip"]').forEach(element=>element.removeAttribute('aria-describedby'));
  document.querySelectorAll('.is-related,.is-highlighted').forEach(element=>element.classList.remove('is-related','is-highlighted'));
}

function showTooltip(element) {
  hideTooltip();
  const record=state.records.find(item=>item.id===Number(element.dataset.id));
  if (!record) return;
  document.querySelectorAll(`.bar[data-id="${record.id}"]`).forEach(bar=>bar.classList.add('is-related'));
  document.querySelectorAll(`.phase-connector[data-feature-id="${record.id}"]`).forEach(line=>line.classList.add('is-highlighted'));
  const kind=element.dataset.kind||'prod', status=kind==='missing'?'missing':scheduleStatus(record,kind);
  const range=kind==='dev'?developmentRange(record):record.prod;
  const warnings=recordWarnings(record);
  const tooltip=document.querySelector('#featureTooltip');
  const productionDates=record.prod?`${formatDate(record.prod.start)} — ${formatDate(record.prod.end)}`:'No Prod Date';
  const label=kind==='missing'?statusLabel(status):phaseStatusLabel(record,kind);
  const showDevDates=kind==='dev'||label==='Late dev';
  const devRange=developmentRange(record);
  tooltip.innerHTML=`<strong>${escapeHtml(record.feature)}</strong><div class="tooltip-status">${statusIcon(status)} ${label}${status==='red'?'':` · ${phaseName(kind)}`}${showDevDates&&!record.dev?' · Estimated':''}</div><small>${escapeHtml(record.team)} · ${escapeHtml(record.track||'No track')}<br>Production: ${productionDates}${showDevDates&&devRange?`<br>Development: ${formatDate(devRange.start)} — ${formatDate(devRange.end)}`:''}</small><p>${escapeHtml(record.comment)||'No description provided.'}</p>${warnings.length?`<ul>${warnings.map(warning=>`<li>! ${escapeHtml(warning)}</li>`).join('')}</ul>`:''}`;
  tooltip.hidden=false;
  const rect=element.getBoundingClientRect();
  tooltip.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-tooltip.offsetWidth-8))}px`;
  tooltip.style.top=`${Math.max(8,rect.bottom+8+tooltip.offsetHeight<=window.innerHeight?rect.bottom+8:rect.top-tooltip.offsetHeight-8)}px`;
  element.setAttribute('aria-describedby','featureTooltip');
}

function bindFeatureInteractions(container) {
  container.querySelectorAll('[data-id]').forEach(element=>element.addEventListener('click',event=>{event.stopPropagation();hideTooltip();openDetail(Number(element.dataset.id));}));
  container.querySelectorAll('.bar[data-id]').forEach(element=>{
    element.addEventListener('mouseenter',()=>showTooltip(element));
    element.addEventListener('mouseleave',hideTooltip);
    element.addEventListener('focus',()=>showTooltip(element));
    element.addEventListener('blur',hideTooltip);
  });
}

function loadingMessage() {
  if (state.loadPhase==='loading') return `<div class="empty-state load-state" role="status"><div><h2>${state.loadAttempt>1?'Still trying to connect…':'Loading your schedule…'}</h2><p>${state.loadAttempt>1?`Attempt ${state.loadAttempt} of 3. We’ll retry automatically if Google doesn’t respond.`:'Getting the latest dates and statuses from Google Sheets.'}</p></div></div>`;
  if (state.loadPhase==='error') return `<div class="empty-state load-state" role="alert"><div><h2>We couldn’t load the schedule</h2><p>${escapeHtml(state.loadError)}</p><button type="button" id="retryLoad">Try again</button></div></div>`;
  return '';
}

function render() {
  hideTooltip();
  const records=filtered();
  document.querySelector('#rangeLabel').textContent=`${formatDate(state.rangeStart)} — ${formatDate(new Date(state.rangeEnd.getFullYear(),state.rangeEnd.getMonth(),state.rangeEnd.getDate()-1))}`;
  document.querySelector('#resultCount').textContent=state.loadPhase==='loading'||state.loadPhase==='error'?'':`${records.length} features`;
  const shell=document.querySelector('#calendarShell');
  shell.innerHTML=loadingMessage()||(records.length?renderSchedule(records):'<div class="empty-state">No features in this date range. Try choosing a different date range.</div>');
  shell.querySelector('#retryLoad')?.addEventListener('click',loadData);
  renderAlerts(records);
  bindFeatureInteractions(shell);
  bindFeatureInteractions(document.querySelector('#teamAlerts'));
}

function openDetail(id) {
  const record=state.records.find(item=>item.id===id);
  if (!record) return;
  const warnings=recordWarnings(record), conflicts=recordConflicts(record);
  const box=kind=>{
    const range=kind==='dev'?developmentRange(record):record.prod, status=scheduleStatus(record,kind);
    return `<div class="detail-box"><span>${phaseName(kind)}</span><strong>${range?`${formatDate(range.start)} — ${formatDate(range.end)}`:kind==='dev'?'No Dev Date':'No Prod Date'}</strong><div class="date-status status-${status}">${statusIcon(status)} ${phaseStatusLabel(record,kind)}</div>${kind==='dev'&&!record.dev&&range?`<small class="estimate-note">! Estimated: 14 days, starting 30 days before ${record.prod?'production starts':'the planned month (no production date)'}</small>`:''}</div>`;
  };
  document.querySelector('#dialogContent').innerHTML=`<div class="dialog-body"><p class="eyebrow">${escapeHtml(record.month)} · ${escapeHtml(record.track||'No track')}</p><h2>${escapeHtml(record.feature)}</h2><div class="team">${escapeHtml(record.event||'No event specified')} · ${escapeHtml(record.team)}</div><div class="detail-grid">${box('dev')}${box('prod')}</div>${warnings.length?`<ul class="detail-warnings">${warnings.map(warning=>`<li>! ${escapeHtml(warning)}</li>`).join('')}</ul>`:''}<div class="comment">${escapeHtml(record.comment)||'No description provided.'}</div>${conflicts.length?`<div class="detail-conflicts"><strong>Overlapping team assignments</strong>${conflicts.map(conflict=>{const other=conflict.a.id===record.id?conflict.b:conflict.a;return `<p>${escapeHtml(other.feature)} (${escapeHtml(other.month)})<small>${escapeHtml(conflictDescription(conflict))}</small></p>`;}).join('')}</div>`:''}<a class="sheet-cell-link" href="https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/edit#gid=${CONFIG.gid}&amp;range=${record.featureColumn}${record.sheetRow}" target="_blank" rel="noopener noreferrer">Open feature in Google Sheets ↗</a></div>`;
  document.querySelector('#detailDialog').showModal();
}
