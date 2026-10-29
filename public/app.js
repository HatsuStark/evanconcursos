'use strict';
// Depende de plans.js (formato e plano embutido). Todo o app trabalha sobre o plano ativo.
const KEY='tjsp2027';
const weekdays=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const $=id=>document.getElementById(id);
const pct=(c,t)=>Math.round(c/t*100);
const DAY_MS=864e5;
const startOfDay=ts=>new Date(ts).setHours(0,0,0,0);
const fmtDate=d=>d.toLocaleDateString('pt-BR');

// ---------- Estado: validação e mesclagem ----------
// Cada alteração guarda um carimbo de tempo; exclusões viram "tombstones" em `deleted`.
// Assim dois dispositivos podem ser mesclados sem que um apague o progresso do outro.
// Chaves por plano: tarefas/metas "plano:semana-dia", links "plano|matéria". Dados antigos (sem plano)
// são migrados para o plano do TJSP de forma determinística, igual em todos os dispositivos.
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const TASK_RE=/^[a-z0-9-]{1,40}:\d+-\d+$/;
const scopeTask=k=>/^\d+-\d+$/.test(k)?DEFAULT_PLAN_ID+':'+k:k;
function hash(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return (h>>>0).toString(36)}
function parseBR(d){const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d||'');return m?new Date(+m[3],m[2]-1,+m[1]).getTime():0}
function isQcUrl(u){try{const x=new URL(u);return x.protocol==='https:'&&(x.hostname==='qconcursos.com'||x.hostname.endsWith('.qconcursos.com'))}catch{return false}}

function normalize(raw){
  raw=plain(raw);
  const s={v:3,tasks:{},taskTimes:{},goals:{},records:[],notes:String(raw.notes||''),notesTime:num(raw.notesTime),discursivas:[],deleted:{},qcLinks:{},plans:{},activePlan:{id:'',ts:0},updatedAt:num(raw.updatedAt)};
  for(const [k,v] of Object.entries(plain(raw.tasks))){const id=scopeTask(k);if(TASK_RE.test(id))s.tasks[id]=!!v}
  for(const [k,v] of Object.entries(plain(raw.taskTimes))){const id=scopeTask(k);if(id in s.tasks)s.taskTimes[id]=num(v)}
  for(const [k,v] of Object.entries(plain(raw.goals))){const id=scopeTask(k),g=plain(v),n=Number(g.n);if(TASK_RE.test(id)&&Number.isInteger(n)&&n>=0&&n<=500)s.goals[id]={n,ts:num(g.ts)}}
  for(const [k,v] of Object.entries(plain(raw.deleted)))s.deleted[k]=num(v);
  for(const [k,v] of Object.entries(plain(raw.plans))){const p=normalizePlan(v);if(p.id===k)s.plans[k]=p}
  const ap=plain(raw.activePlan);if(isPlanId(ap.id))s.activePlan={id:ap.id,ts:num(ap.ts)};
  const records=new Map(),seen={};
  for(const r of Array.isArray(raw.records)?raw.records:[]){
    if(!r||typeof r!=='object')continue;
    const correct=Number(r.correct),total=Number(r.total);
    if(!Number.isInteger(correct)||!Number.isInteger(total)||total<1||correct<0||correct>total)continue;
    const subject=String(r.subject||'Outros'),date=String(r.date||''),assunto=String(r.assunto||'').trim().slice(0,120);
    let id=typeof r.id==='string'&&r.id?r.id:'';
    // Registros antigos não tinham id: gera um determinístico para que dispositivos diferentes cheguem ao mesmo valor.
    if(!id){const base=[date,subject,correct,total].join('|');seen[base]=(seen[base]||0)+1;id='r-'+hash(base+'|'+seen[base])}
    // taskId liga o registro à tarefa do cronograma; theme agrupa as sessões de um mesmo tema para a revisão espaçada.
    const planId=isPlanId(r.planId)?r.planId:DEFAULT_PLAN_ID;
    const taskId=TASK_RE.test(scopeTask(String(r.taskId||'')))?scopeTask(r.taskId):'';
    const theme=String(r.theme||'').replace(/^task:(\d+-\d+)$/,'task:'+DEFAULT_PLAN_ID+':$1').slice(0,200);
    records.set(id,{id,subject,assunto,correct,total,date,ts:num(r.ts)||parseBR(date),taskId,theme,planId});
  }
  const discs=new Map();
  for(const d of Array.isArray(raw.discursivas)?raw.discursivas:[]){
    if(!d||typeof d!=='object'||!d.title)continue;
    const score=d.score===null||d.score===undefined||d.score===''?null:Number(d.score);
    const id=typeof d.id==='string'&&d.id?d.id:'d-'+hash(String(d.title)+'|'+String(d.date));
    discs.set(id,{id,title:String(d.title),answer:String(d.answer||''),score:Number.isFinite(score)&&score>=0&&score<=10?score:null,subject:String(d.subject||''),date:String(d.date||''),ts:num(d.ts)||parseBR(d.date)});
  }
  for(const [k,v] of Object.entries(plain(raw.qcLinks))){
    const key=k.includes('|')?k:DEFAULT_PLAN_ID+'|'+k,l=plain(v),url=String(l.url||'');
    if(url===''||isQcUrl(url))s.qcLinks[key]={url,ts:num(l.ts)};
  }
  s.records=[...records.values()].filter(r=>!(r.id in s.deleted));
  s.discursivas=[...discs.values()].filter(d=>!(d.id in s.deleted));
  return s;
}

function merge(a,b){
  a=normalize(a);b=normalize(b);
  const m=normalize({});
  for(const k of new Set([...Object.keys(a.tasks),...Object.keys(b.tasks)])){
    const ta=a.taskTimes[k]||0,tb=b.taskTimes[k]||0;
    m.tasks[k]=ta===tb?!!(a.tasks[k]||b.tasks[k]):!!(ta>tb?a:b).tasks[k];
    m.taskTimes[k]=Math.max(ta,tb);
  }
  for(const s of [a,b])for(const [k,v] of Object.entries(s.deleted))m.deleted[k]=Math.max(m.deleted[k]||0,v);
  const union=(x,y)=>{const map=new Map();for(const it of [...x,...y])if(!(it.id in m.deleted))map.set(it.id,it);return [...map.values()].sort((p,q)=>p.ts-q.ts)};
  m.records=union(a.records,b.records);
  m.discursivas=union(a.discursivas,b.discursivas);
  const nb=b.notesTime>a.notesTime||(b.notesTime===a.notesTime&&b.notes.length>a.notes.length)?b:a;
  m.notes=nb.notes;m.notesTime=nb.notesTime;
  // Itens com carimbo próprio: vence o mais recente.
  for(const field of ['qcLinks','goals','plans'])
    for(const s of [a,b])for(const [k,v] of Object.entries(s[field]))if(!m[field][k]||v.ts>m[field][k].ts)m[field][k]=v;
  for(const k of Object.keys(m.plans))if(('plan:'+k) in m.deleted&&m.deleted['plan:'+k]>=m.plans[k].ts)delete m.plans[k];
  m.activePlan=b.activePlan.ts>a.activePlan.ts?b.activePlan:a.activePlan;
  m.updatedAt=Math.max(a.updatedAt,b.updatedAt);
  return m;
}

let state;
try{state=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch{state=normalize({})}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
function save(){state.updatedAt=Date.now();persist();window.queueCloudSave?.()}

// ---------- Planos ----------
// O embutido pode ser editado (a cópia editada fica em state.plans com o mesmo id) mas não excluído.
const planDeleted=id=>('plan:'+id) in state.deleted&&!(state.plans[id]&&state.plans[id].ts>state.deleted['plan:'+id]);
function getPlan(id){return planDeleted(id)&&!BUILTIN_PLANS[id]?null:state.plans[id]||BUILTIN_PLANS[id]||null}
function allPlans(){return [...new Set([...Object.keys(BUILTIN_PLANS),...Object.keys(state.plans)])].map(getPlan).filter(Boolean)}
function activePlan(){return getPlan(state.activePlan.id)||BUILTIN_PLANS[DEFAULT_PLAN_ID]}
const planStart=p=>parseYmd(p.startDate)||new Date();
const planTotal=p=>p.weeks.length*7;
// Sem cronograma ainda, usa as horas informadas no gerador.
const weeklyHours=p=>(p.weeks[0]?p.weeks[0].days.map(d=>d.hours):normalizeConfig(p.config,p).hours).reduce((s,h)=>s+h,0);
const planRecords=p=>state.records.filter(r=>r.planId===p.id);
function uniquePlanId(name){let base=slugify(name),id=base,i=2;while(getPlan(id)||state.plans[id])id=(base.slice(0,36)+'-'+i++);return id}

// ---------- Foco adaptativo ----------
// Acerto suavizado: começa em 70% (peso de 10 questões) e os resultados decaem com meia-vida de 30 dias.
const PRIOR=.7,PRIOR_WEIGHT=10,HALF_LIFE_DAYS=30;
function analyze(p=activePlan()){
  const now=Date.now(),bySubject={},byTopic={},core=new Set(p.subjects.filter(s=>s.core).map(s=>s.name));
  const add=(map,key,r,w,extra)=>{const e=map[key]||(map[key]={subject:r.subject,c:0,t:0,cw:0,tw:0,...extra});e.c+=r.correct;e.t+=r.total;e.cw+=r.correct*w;e.tw+=r.total*w};
  for(const r of planRecords(p)){
    const w=r.ts?Math.pow(.5,Math.max(0,now-r.ts)/DAY_MS/HALF_LIFE_DAYS):.5;
    add(bySubject,r.subject,r,w);
    if(r.assunto)add(byTopic,r.subject+'|'+r.assunto.toLowerCase(),r,w,{assunto:r.assunto});
  }
  const priority=e=>(1-(e.cw+PRIOR*PRIOR_WEIGHT)/(e.tw+PRIOR_WEIGHT))*(core.has(e.subject)?1.2:1);
  const rows=p.subjects.map(({name})=>{const e=bySubject[name]||{subject:name,c:0,t:0,cw:0,tw:0};return {...e,priority:priority(e)}}).sort((x,y)=>y.priority-x.priority);
  const weakTopics=Object.values(byTopic).filter(e=>e.t>=5).map(e=>({...e,priority:priority(e)})).sort((x,y)=>y.priority-x.priority);
  return {rows,weakTopics};
}
// Monta a URL do filtro do QConcursos (formulário GET de /questoes-de-concursos/questoes).
// Ponto de partida: o link da matéria (completo) ou, na falta dele, o filtro base do concurso,
// do qual só se aproveitam os campos comuns a todas as matérias (banca, cargo, anos...).
// O foco ajusta o resto: `q` = assunto, `my_questions` = not_resolved/wrong e `difficulty[]`.
const QC_QUESTIONS='https://www.qconcursos.com/questoes-de-concursos/questoes';
const QC_BASE_KEYS=['examining_board_ids[]','job_ids[]','institute_ids[]','publication_year[]','scholarity_ids[]','administrative_level_ids[]','modality_ids[]','sort','per_page'];
// Acerto baixo → questões médias; acerto alto → questões mais difíceis.
const difficultyFor=acc=>acc<.6?['2','3']:acc<.8?['3','4']:['4','5'];
const linkKey=(planId,key)=>planId+'|'+key;
function qcUrl(subject,assunto,mode,acc,planId=activePlan().id){
  const own=state.qcLinks[linkKey(planId,subject)]?.url,base=state.qcLinks[linkKey(planId,'_base')]?.url;
  const url=new URL(QC_QUESTIONS),p=url.searchParams;
  if(own)url.search=new URL(own).search;
  else if(base)for(const [k,v] of new URL(base).searchParams)if(QC_BASE_KEYS.includes(k))p.append(k,v);
  for(const k of ['q','my_questions','page','difficulty[]'])p.delete(k);
  const keyword=assunto||(own?'':subject);
  if(keyword)p.set('q',keyword);
  p.set('my_questions',mode);
  if(mode==='not_resolved'&&acc!=null)difficultyFor(acc).forEach(d=>p.append('difficulty[]',d));
  p.set('exclude_nullified','true');
  p.set('exclude_outdated','true');
  return url.href;
}
function linkButton({href,label},secondary){const a=document.createElement('a');a.className='button'+(secondary?' secondary':'');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;return a}

// ---------- Cronograma → questões ----------
// Cada tarefa do plano é um tema de questões: matéria, palavra-chave e meta (padrão: 10 questões por hora).
function taskInfo(id){
  const [planId,wd]=id.split(':'),[w,d]=wd.split('-').map(Number);
  const day=getPlan(planId)?.weeks[w]?.days[d]||{text:'',hours:0,subject:'',keyword:'',goal:0};
  const goal=state.goals[id]?.n||day.goal||Math.round(day.hours*10)||20;
  return {id,planId,text:day.text,hours:day.hours,subject:day.subject,keyword:day.keyword,goal,theme:'task:'+id,week:w,day:d};
}
function todayInfo(p=activePlan()){
  const total=planTotal(p);if(!total)return null;
  const d=Math.round((startOfDay(Date.now())-planStart(p).getTime())/DAY_MS),idx=Math.max(0,Math.min(total-1,d));
  return {...taskInfo(`${p.id}:${Math.floor(idx/7)}-${idx%7}`),before:d<0,after:d>=total};
}
const themeKey=r=>r.theme||(r.assunto?r.planId+'|'+r.subject+'|'+r.assunto.toLowerCase():'');
function themeStats(key){
  const list=state.records.filter(r=>themeKey(r)===key);
  const c=list.reduce((s,r)=>s+r.correct,0),t=list.reduce((s,r)=>s+r.total,0);
  return {list,c,t,acc:t?c/t:null};
}
// Avaliação de uma sessão: abaixo de 75% o tema entra na fila de reforço.
const WEAK=.75,GOOD=.85;
function evaluate(acc){
  if(acc==null)return {text:'Sem questões registradas',cls:''};
  return acc>=GOOD?{text:'Ótimo: tema dominado',cls:'ok'}:acc>=WEAK?{text:'Bom: siga em frente',cls:'ok'}:acc>=.6?{text:'Atenção: entrou no reforço',cls:'warning'}:{text:'Reforçar: entrou no reforço',cls:'bad'};
}
// Revisão espaçada: tema fraco volta em 1, 3 e 7 dias; cada dia de revisão com ≥75% avança uma etapa,
// abaixo disso recomeça. Depois da 3ª revisão boa o tema sai da fila. Tudo é derivado dos registros,
// então a sincronização entre dispositivos não precisa de estado extra.
const REVIEW_DAYS=[1,3,7];
function reviewQueue(p=activePlan()){
  const groups=new Map();
  for(const r of planRecords(p)){const k=themeKey(r);if(k){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}}
  const out=[];
  for(const [key,list] of groups){
    const days=new Map();
    for(const r of list){const d=startOfDay(r.ts);const e=days.get(d)||{d,c:0,t:0};e.c+=r.correct;e.t+=r.total;days.set(d,e)}
    const sessions=[...days.values()].sort((x,y)=>x.d-y.d);
    let stage=0,weak=false;
    for(const s of sessions){if(s.c/s.t<WEAK){weak=true;stage=0}else if(weak)stage++}
    if(!weak||stage>=REVIEW_DAYS.length)continue;
    const last=sessions[sessions.length-1],sample=list[list.length-1];
    const info=key.startsWith('task:')?taskInfo(key.slice(5)):{text:sample.assunto,subject:sample.subject,keyword:sample.assunto};
    out.push({key,stage,last,due:last.d+REVIEW_DAYS[stage]*DAY_MS,label:info.text,subject:info.subject||sample.subject,keyword:info.keyword===WEAK_MARK?'':info.keyword});
  }
  return out.sort((x,y)=>x.due-y.due);
}
function weakestKeyword(subject){return analyze().weakTopics.find(t=>t.subject===subject)?.assunto||''}

// Bloco de prática: meta, avaliação, botões para o QConcursos e registro de acertos/erros.
function practiceBlock({subject,keyword,theme,goal,taskId,label}){
  const p=activePlan(),box=document.createElement('div');box.className='practice';
  const kw=keyword===WEAK_MARK?weakestKeyword(subject):keyword;
  const {c,t,acc}=themeStats(theme);
  const status=document.createElement('div');status.className='practice-status';
  const ev=evaluate(acc);
  const done=document.createElement('span');
  done.textContent=t?`${t}${goal?' de '+goal:''} questões · ${c} certas, ${t-c} erradas · ${pct(c,t)}%`:(goal?`Meta: ${goal} questões`:'Nenhuma questão registrada');
  const badge=document.createElement('span');badge.className='badge '+ev.cls;badge.textContent=ev.text;
  status.append(done);if(t)status.append(badge);
  if(goal){const bar=document.createElement('progress');bar.max=goal;bar.value=Math.min(t,goal);status.append(bar)}
  const where=document.createElement('div');where.className='note';
  where.textContent=`${subject}${kw?' · assunto: '+kw:''}`+(state.qcLinks[linkKey(p.id,subject)]?.url?'':state.qcLinks[linkKey(p.id,'_base')]?.url?' · filtro base (salve o link da matéria para filtrar pela disciplina)':' · sem filtro salvo: busca só por palavra-chave');
  const links=document.createElement('div');links.className='actions';
  links.append(linkButton({label:'Resolver questões',href:qcUrl(subject,kw,'not_resolved',t>=10?acc:null)}));
  if(t)links.append(linkButton({label:'Refazer as que errei',href:qcUrl(subject,kw,'wrong')},true));
  const form=document.createElement('div');form.className='fields';
  const field=(text,cls)=>{const l=document.createElement('label'),i=document.createElement('input');i.type='number';i.min='0';i.inputMode='numeric';if(cls)l.className=cls;l.append(text+' ',i);return [l,i]};
  const [lc,ic]=field('Acertei'),[lw,iw]=field('Errei');
  const btn=document.createElement('button');btn.className='small';btn.textContent='Salvar';
  form.append(lc,lw,btn);
  if(taskId){const [lg,ig]=field('Meta','goal');ig.value=goal;ig.onchange=()=>{const n=Number(ig.value);if(Number.isInteger(n)&&n>0&&n<=500){state.goals[taskId]={n,ts:Date.now()};save();render()}};form.append(lg)}
  btn.onclick=()=>{
    const a=Number(ic.value||0),e=Number(iw.value||0);
    if(!Number.isInteger(a)||!Number.isInteger(e)||a<0||e<0||a+e<1)return alert('Informe quantas acertou e quantas errou.');
    state.records.push({id:crypto.randomUUID(),subject,assunto:kw||'',correct:a,total:a+e,date:fmtDate(new Date()),ts:Date.now(),taskId:taskId||'',theme,planId:p.id});
    // Meta cumprida marca a tarefa como feita no cronograma.
    if(taskId&&goal&&t+a+e>=goal&&!state.tasks[taskId]){state.tasks[taskId]=true;state.taskTimes[taskId]=Date.now()}
    save();render();
  };
  box.append(status,where,links,form);
  if(label){const l=document.createElement('strong');l.textContent=label;box.prepend(l)}
  return box;
}

// ---------- Renderização ----------
const week=$('week');
function currentWeek(p=activePlan()){return Math.max(0,Math.min(p.weeks.length-1,Math.floor((Date.now()-planStart(p).getTime())/(7*DAY_MS))))}
function setupPlanControls(){
  const p=activePlan();
  $('planSelect').replaceChildren(...allPlans().map(x=>new Option(x.name,x.id,false,x.id===p.id)));
  week.replaceChildren(...p.weeks.map((w,i)=>{const d=new Date(planStart(p));d.setDate(d.getDate()+i*7);return new Option(`Semana ${i+1} · ${d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,i)}));
  if(p.weeks.length)week.value=currentWeek(p);
  $('subject').replaceChildren(...p.subjects.map(s=>new Option(s.name)));
  const disc=$('discSubject'),prev=disc.value;
  disc.replaceChildren(...p.subjects.map(s=>new Option(s.name)));if(prev)disc.value=prev;
  const exam=parseYmd(p.examDate);
  $('planBrand').textContent=[p.cargo,p.banca].filter(Boolean).join(' · ')||'Plano de estudos';
  $('planMeta').textContent=`${weeklyHours(p)} horas por semana · Prova: ${exam?exam.toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}):'data a definir'}`;
  document.title=`Evan Concursos · ${p.name}`;
  renderLinks();renderPlans();renderGenerator();
}

function renderWeek(){
  const p=activePlan(),list=$('daysList');
  week.parentElement.hidden=!p.weeks.length;
  if(!p.weeks.length){$('focus').textContent='';list.replaceChildren(Object.assign(document.createElement('p'),{className:'muted',textContent:'Este plano ainda não tem cronograma. Preencha o gerador acima e clique em "Gerar cronograma", ou importe um plano pronto em Conta e planos.'}));return}
  const n=Number(week.value);
  $('focus').textContent=p.weeks[n].title;
  const today=todayInfo(p)?.id;
  list.replaceChildren(...p.weeks[n].days.map((day,i)=>{
    const id=`${p.id}:${n}-${i}`,info=taskInfo(id),card=document.createElement('div'),label=document.createElement('label'),cb=document.createElement('input'),wrap=document.createElement('div'),head=document.createElement('strong'),text=document.createElement('div');
    card.className='day'+(id===today?' today':'');label.className='day-top';cb.type='checkbox';cb.checked=!!state.tasks[id];
    cb.onchange=()=>{state.tasks[id]=cb.checked;state.taskTimes[id]=Date.now();save();render()};
    head.textContent=weekdays[i]+(day.hours?` · ${day.hours}h`:'')+(id===today?' · hoje':'');
    text.textContent=day.text||'—';text.className=cb.checked?'done':'';
    wrap.append(head,text);label.append(cb,wrap);card.append(label);
    if(info.subject){
      // Hoje: bloco aberto. Demais dias: recolhido, com o resumo no título.
      const {c,t}=themeStats(info.theme);
      const det=document.createElement('details'),sum=document.createElement('summary');
      sum.textContent=`Questões · meta ${info.goal}`+(t?` · ${t} feitas (${pct(c,t)}%)`:'');
      det.open=id===today;det.append(sum,practiceBlock({...info,taskId:id}));card.append(det);
    }
    return card;
  }));
}
function renderHome(){
  const p=activePlan(),total=planTotal(p),prefix=p.id+':';
  const completed=Object.entries(state.tasks).filter(([k,v])=>v&&k.startsWith(prefix)).length;
  $('done').textContent=completed;
  $('progress').max=total||1;$('progress').value=completed;
  $('progressLabel').textContent=total?`${completed} de ${total} tarefas concluídas`:'Plano sem cronograma ainda';
  const exam=parseYmd(p.examDate);
  $('days').textContent=exam?Math.max(0,Math.ceil((exam-new Date())/DAY_MS)):'—';
  const recs=planRecords(p),c=recs.reduce((s,r)=>s+r.correct,0),t=recs.reduce((s,r)=>s+r.total,0);
  $('accuracy').textContent=t?pct(c,t)+'%':'—';
  const h=p.weeks[0]?.days.map(d=>d.hours)||[];
  $('hoursLine').textContent=h.length?`${h.slice(0,5).every(x=>x===h[0])?h[0]+'h nos dias úteis':'Dias úteis: '+h.slice(0,5).join('/')+'h'} · ${h[5]}h sábado · ${h[6]}h domingo`:'';
}
function renderPerformance(){
  const p=activePlan(),{rows}=analyze(p);
  // Hoje: a tarefa do dia do cronograma, pronta para resolver e registrar.
  const today=todayInfo(p),todayBox=$('todayPanel');
  if(!today){
    todayBox.replaceChildren(Object.assign(document.createElement('p'),{className:'muted',textContent:'Este plano ainda não tem cronograma. Use o formulário "Registrar outra bateria" abaixo.'}));
  }else{
    const head=document.createElement('p');head.className='muted';
    head.textContent=(today.before?`O plano começa em ${fmtDate(planStart(p))}. Primeira tarefa — `:today.after?'Plano concluído. Última tarefa — ':'')+`Semana ${today.week+1}, ${weekdays[today.day]}: ${today.text}`;
    if(today.subject)todayBox.replaceChildren(head,practiceBlock({...today,taskId:today.id}));
    else todayBox.replaceChildren(head,Object.assign(document.createElement('p'),{className:'note',textContent:'Tarefa sem questões por matéria (simulado, correção ou descanso). Registre os resultados por matéria no formulário abaixo.'}));
  }
  // Reforço: temas fracos em revisão espaçada; primeiro os vencidos.
  const queue=reviewQueue(p),endToday=startOfDay(Date.now())+DAY_MS;
  const due=queue.filter(q=>q.due<endToday);
  $('reviewList').replaceChildren(...(queue.length?queue.map(q=>{
    const div=document.createElement('div');div.className='focus-item'+(q.due<endToday?' due':'');
    const late=Math.floor((startOfDay(Date.now())-q.due)/DAY_MS);
    const when=document.createElement('div');when.className='note';
    when.textContent=(q.due<endToday?(late>0?`Atrasada há ${late} dia(s)`:'Revisar hoje'):`Próxima revisão em ${fmtDate(new Date(q.due))}`)+
      ` · revisão ${q.stage+1} de ${REVIEW_DAYS.length} (sugestão: 10 questões) · último dia: ${q.last.c}/${q.last.t} (${pct(q.last.c,q.last.t)}%)`;
    div.append(practiceBlock({subject:q.subject,keyword:q.keyword,theme:q.key,goal:0,label:q.label}),when);
    return div;
  }):[Object.assign(document.createElement('p'),{className:'muted',textContent:'Nenhum tema em reforço. Temas com menos de 75% de acerto aparecem aqui automaticamente.'})]));
  const todayStats=today?.subject?themeStats(today.theme):{t:0};
  $('homeFocus').textContent=today?`Hoje: ${today.text}`+(today.subject?` · ${todayStats.t} de ${today.goal} questões`:'')+(due.length?` · ${due.length} revisão(ões) pendente(s)`:''):'Plano sem cronograma ainda: gere em Cronograma.';
  const maxP=Math.max(...rows.map(r=>r.priority),.01);
  $('subjectTable').replaceChildren(...rows.map(r=>{
    const tr=document.createElement('tr'),bar=document.createElement('div'),fill=document.createElement('span');
    bar.className='bar';fill.style.width=Math.round(r.priority/maxP*100)+'%';bar.append(fill);
    const cells=[r.subject,String(r.t),r.t?pct(r.c,r.t)+'%':'—'];
    cells.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i)td.className='num';tr.append(td)});
    const td=document.createElement('td');td.append(bar);tr.append(td);return tr;
  }));
  const recs=planRecords(p),list=$('records');
  if(!recs.length){list.textContent='Nenhum registro ainda.';}
  else list.replaceChildren(...recs.slice(-15).reverse().map(r=>{
    const row=document.createElement('div'),text=document.createElement('span'),del=document.createElement('button');
    row.className='record';
    text.textContent=`${r.date} · ${r.subject}${r.assunto?' ('+r.assunto+')':''}: ${r.correct}/${r.total} (${pct(r.correct,r.total)}%)`;
    del.className='secondary small';del.textContent='Excluir';del.setAttribute('aria-label','Excluir registro de '+r.subject);
    del.onclick=()=>{if(!confirm('Excluir este registro?'))return;state.deleted[r.id]=Date.now();state.records=state.records.filter(x=>x.id!==r.id);save();render()};
    row.append(text,del);return row;
  }));
  const used=[...new Set(recs.filter(r=>r.assunto&&r.subject===$('subject').value).map(r=>r.assunto))];
  $('assuntos').replaceChildren(...used.map(a=>new Option(a)));
}
function renderLinks(){
  const p=activePlan();
  $('linkCfg').replaceChildren(...[['_base','Filtro base do concurso (banca, cargo, anos) — vale para todas as matérias'],...p.subjects.map(s=>[s.name,s.name])].map(([key,text])=>{
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='url';input.dataset.key=linkKey(p.id,key);input.dataset.label=text;input.placeholder='https://www.qconcursos.com/questoes-de-concursos/questoes?...';input.value=state.qcLinks[linkKey(p.id,key)]?.url||'';
    label.append(text,input);return label;
  }));
}
function renderPlans(){
  const active=activePlan();
  $('planList').replaceChildren(...allPlans().map(p=>{
    const row=document.createElement('div');row.className='record';
    const info=document.createElement('span'),exam=parseYmd(p.examDate),done=Object.entries(state.tasks).filter(([k,v])=>v&&k.startsWith(p.id+':')).length;
    info.textContent=`${p.name}${p.id===active.id?' (ativo)':''} · ${[p.cargo,p.banca].filter(Boolean).join(' · ')||'sem cargo/banca'} · prova ${exam?fmtDate(exam):'a definir'} · ${planTotal(p)?`${done}/${planTotal(p)} tarefas`:'sem cronograma'}`;
    const actions=document.createElement('div');actions.className='actions';
    if(p.id!==active.id){const b=document.createElement('button');b.className='secondary small';b.textContent='Ativar';b.onclick=()=>switchPlan(p.id);actions.append(b)}
    if(!BUILTIN_PLANS[p.id]){const b=document.createElement('button');b.className='secondary small';b.textContent='Excluir';b.onclick=()=>deletePlan(p.id);actions.append(b)}
    row.append(info,actions);return row;
  }));
  $('planName').value=active.name;$('planCargo').value=active.cargo;$('planBanca').value=active.banca;
  $('planExam').value=active.examDate;$('planStart').value=active.startDate;
  $('planSubjects').value=active.subjects.map(s=>(s.core?'* ':'')+s.name).join('\n');
}
function renderDisc(){
  $('discList').replaceChildren(...state.discursivas.slice().reverse().map(item=>{
    const div=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),body=document.createElement('p'),del=document.createElement('button');
    div.className='disc-item';title.textContent=item.title;
    meta.textContent=`${item.date} · ${item.subject} · Nota: ${item.score??'não informada'}`;
    body.textContent=item.answer;
    del.className='secondary';del.textContent='Excluir';
    del.onclick=()=>{if(!confirm('Excluir esta discursiva?'))return;state.deleted[item.id]=Date.now();state.discursivas=state.discursivas.filter(x=>x.id!==item.id);save();renderDisc()};
    div.append(title,document.createElement('br'),meta,body,del);return div;
  }));
}
function render(){renderWeek();renderHome();renderPerformance()}

// ---------- Gerador de cronograma (formulário) ----------
function renderGenerator(){
  const p=activePlan(),cfg=normalizeConfig(p.config,p);
  $('genDetails').open=!p.weeks.length;
  $('genHours').replaceChildren(...weekdays.map((d,i)=>{
    const l=document.createElement('label'),inp=document.createElement('input');
    inp.type='number';inp.min='0';inp.max='16';inp.step='0.5';inp.value=cfg.hours[i];inp.dataset.day=i;
    l.append(d.slice(0,3),inp);return l;
  }));
  $('genReview').checked=cfg.weeklyReview;
  $('genSubjects').replaceChildren(...p.subjects.map(({name})=>{
    const s=cfg.subjects[name],det=document.createElement('details'),sum=document.createElement('summary');
    det.dataset.subject=name;
    const describe=()=>{sum.textContent=`${name} · peso ${weight.value} · ${LEVELS[level.value]} · ${splitTopics(topics.value).length} tópico(s)`};
    const select=(opts,val)=>{const el=document.createElement('select');opts.forEach(([v,t])=>el.add(new Option(t,v)));el.value=String(val);el.onchange=describe;return el};
    const weight=select([1,2,3,4,5].map(n=>[n,`Peso ${n}${n===1?' (pouco cobrada)':n===5?' (muito cobrada)':''}`]),s.weight);weight.className='w';
    const level=select(LEVELS.map((t,i)=>[i,'Meu nível: '+t]),s.level);level.className='l';
    const topics=document.createElement('textarea');topics.className='t';topics.placeholder='Conteúdo programático desta matéria (cole do edital)';topics.value=s.topics.join('\n');topics.oninput=describe;
    const row=document.createElement('div');row.className='fields';row.append(weight,level);
    det.append(sum,row,topics);describe();return det;
  }));
}
function readGeneratorForm(){
  return {hours:[...$('genHours').querySelectorAll('input')].map(i=>Number(i.value)||0),weeklyReview:$('genReview').checked,
    subjects:Object.fromEntries([...$('genSubjects').children].map(d=>[d.dataset.subject,{weight:Number(d.querySelector('.w').value),level:Number(d.querySelector('.l').value),topics:splitTopics(d.querySelector('.t').value)}]))};
}
// Refazer o cronograma muda o conteúdo de cada dia: zera marcações e metas do plano e desliga os
// registros antigos das tarefas (eles seguem valendo por matéria e assunto, inclusive no reforço).
function applyGenerated(p,result){
  const now=Date.now(),prefix=p.id+':';
  for(const k of Object.keys(state.tasks))if(k.startsWith(prefix)&&state.tasks[k]){state.tasks[k]=false;state.taskTimes[k]=now}
  for(const k of Object.keys(state.goals))if(k.startsWith(prefix)&&state.goals[k].n)state.goals[k]={n:0,ts:now};
  for(const r of state.records)if(r.planId===p.id&&r.taskId){r.taskId='';r.theme=''}
  savePlan({...p,weeks:result.weeks,startDate:result.startDate,config:result.config});
  setupPlanControls();render();
}

// ---------- Ações de plano ----------
function switchPlan(id){state.activePlan={id,ts:Date.now()};save();setupPlanControls();render()}
function deletePlan(id){
  const p=getPlan(id);if(!p||BUILTIN_PLANS[id])return;
  if(!confirm(`Excluir o plano "${p.name}"? Os registros de questões dele continuam no backup.`))return;
  delete state.plans[id];state.deleted['plan:'+id]=Date.now();
  if(activePlan().id===id||state.activePlan.id===id)state.activePlan={id:DEFAULT_PLAN_ID,ts:Date.now()};
  save();setupPlanControls();render();
}
function readPlanForm(){
  const subjects=$('planSubjects').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>({name:l.replace(/^\*\s*/,''),core:l.startsWith('*')}));
  return {name:$('planName').value.trim(),cargo:$('planCargo').value.trim(),banca:$('planBanca').value.trim(),examDate:$('planExam').value,startDate:$('planStart').value,subjects};
}
function savePlan(p){state.plans[p.id]={...normalizePlan(p),ts:Date.now()};save()}

// ---------- Eventos ----------
week.onchange=renderWeek;
$('today').onclick=()=>{if(activePlan().weeks.length){week.value=currentWeek();renderWeek()}};
$('subject').onchange=renderPerformance;
$('planSelect').onchange=e=>switchPlan(e.target.value);
$('add').onclick=()=>{
  const c=Number($('correct').value||0),w=Number($('wrong').value||0);
  if(!Number.isInteger(c)||!Number.isInteger(w)||c<0||w<0||c+w<1)return alert('Informe quantas acertou e quantas errou.');
  state.records.push({id:crypto.randomUUID(),subject:$('subject').value,assunto:$('assunto').value.trim().slice(0,120),correct:c,total:c+w,date:fmtDate(new Date()),ts:Date.now(),planId:activePlan().id});
  $('assunto').value='';$('correct').value='';$('wrong').value='';save();render();
};
$('saveLinks').onclick=()=>{
  const inputs=[...$('linkCfg').querySelectorAll('input')];
  const bad=inputs.filter(i=>i.value.trim()&&!isQcUrl(i.value.trim()));
  if(bad.length){$('linkStatus').textContent='Link inválido em: '+bad.map(i=>i.dataset.label).join(', ')+'. Use um endereço https do qconcursos.com.';return}
  for(const i of inputs){const url=i.value.trim();if(url!==(state.qcLinks[i.dataset.key]?.url||''))state.qcLinks[i.dataset.key]={url,ts:Date.now()}}
  save();renderPerformance();renderWeek();$('linkStatus').textContent='Links salvos.';
};
$('planSave').onclick=()=>{
  const f=readPlanForm(),p=activePlan();
  if(!f.name||!f.subjects.length)return alert('Informe ao menos o nome do plano e uma matéria.');
  const removed=p.subjects.map(s=>s.name).filter(n=>!f.subjects.some(s=>s.name===n));
  if(removed.length&&!confirm(`As matérias ${removed.join(', ')} saem do plano e os dias delas ficam sem filtro de questões. Continuar?`))return;
  savePlan({...p,...f});setupPlanControls();render();$('planStatus').textContent='Plano salvo.';
};
$('planNew').onclick=()=>{
  const f=readPlanForm();
  if(!f.name||!f.subjects.length)return alert('Informe ao menos o nome do plano e uma matéria.');
  if(f.name===activePlan().name)return alert('Dê um nome diferente ao novo plano.');
  const id=uniquePlanId(f.name);
  savePlan({...f,id,weeks:[]});switchPlan(id);$('planStatus').textContent='Plano criado. O cronograma será gerado na próxima etapa; até lá, importe um plano pronto se tiver.';
};
$('genRun').onclick=()=>{
  const p=activePlan();let result;
  try{result=generateWeeks(p,readGeneratorForm())}catch(err){$('genStatus').textContent=err.message;return}
  const s=result.summary,done=Object.entries(state.tasks).filter(([k,v])=>v&&k.startsWith(p.id+':')).length;
  const msg=`Cronograma de ${s.weeks} semanas, ${s.studyDays} dias de estudo (${s.hours}h):\n`+
    `• teoria: ${s.theory} dias\n• consolidação com questões: ${s.consol} dias\n• reta final (simulados e revisão): ${s.final} dias\n\n`+
    s.perSubject.map(x=>`${x.name}: ${x.days} dia(s) de teoria`).join('\n')+
    (p.weeks.length?`\n\nO cronograma atual será substituído${done?` e as ${done} tarefa(s) marcada(s) como feitas serão desmarcadas`:''}. Seus registros de questões continuam valendo por matéria e assunto.`:'')+'\n\nAplicar?';
  if(!confirm(msg))return;
  applyGenerated(p,result);$('genStatus').textContent='Cronograma gerado.';showView('cronograma');
};
$('planExport').onclick=()=>{
  const p=activePlan(),{ts,...data}=p;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=`plano-${p.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('planImportButton').onclick=()=>$('planImportFile').click();
$('planImportFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const raw=JSON.parse(await file.text());
    if(!raw||!Array.isArray(raw.subjects)||!raw.subjects.length)throw Error();
    const p=normalizePlan(raw);
    if(getPlan(p.id)&&!confirm(`Já existe o plano "${getPlan(p.id).name}" com o mesmo identificador. Substituir? (Cancelar importa como novo plano.)`))p.id=uniquePlanId(p.name);
    savePlan(p);switchPlan(p.id);alert(`Plano "${p.name}" importado.`);
  }catch{alert('Arquivo de plano inválido.')}
};
const notes=$('notes');
notes.value=state.notes;
notes.oninput=()=>{state.notes=notes.value;state.notesTime=Date.now();save()};
$('discAdd').onclick=()=>{
  const title=$('discTitle').value.trim(),answer=$('discAnswer').value.trim(),raw=$('discScore').value,score=raw===''?null:Number(raw);
  if(!title||!answer||score!==null&&(!Number.isFinite(score)||score<0||score>10))return alert('Preencha tema e resposta; nota entre 0 e 10.');
  state.discursivas.push({id:crypto.randomUUID(),title,answer,score,subject:$('discSubject').value,date:fmtDate(new Date()),ts:Date.now()});
  $('discTitle').value='';$('discAnswer').value='';$('discScore').value='';save();renderDisc();
};
$('export').onclick=()=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
  a.download=`evan-concursos-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('importButton').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const obj=JSON.parse(await file.text());
    if(!obj||typeof obj!=='object'||!obj.tasks||!Array.isArray(obj.records))throw Error();
    window.TJSP.apply(merge(state,obj));save();alert('Backup mesclado com os dados atuais.');
  }catch{alert('Arquivo inválido.')}
};

// API usada por cloud.js.
window.TJSP={
  getState:()=>state,normalize,merge,
  apply(next){
    const prev=JSON.stringify([state.qcLinks,state.plans,state.activePlan]);
    state=normalize(next);persist();
    if(notes.value!==state.notes)notes.value=state.notes;
    if(JSON.stringify([state.qcLinks,state.plans,state.activePlan])!==prev)setupPlanControls();
    render();renderDisc();
  },
};

// ---------- Navegação e tema ----------
const labels={inicio:'Visão geral',cronograma:'Cronograma',desempenho:'Desempenho',discursivas:'Discursivas',conta:'Conta, planos e backup'};
function showView(v){
  if(!labels[v])return;
  document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!=='view-'+v);
  document.querySelectorAll('[data-view]').forEach(e=>{const active=e.dataset.view===v;e.classList.toggle('active',active);e.setAttribute('aria-current',active?'page':'false')});
  $('pageTitle').textContent=labels[v];window.scrollTo(0,0);
}
document.querySelectorAll('[data-view],[data-go]').forEach(e=>e.addEventListener('click',()=>showView(e.dataset.view||e.dataset.go)));
$('goWeek').addEventListener('click',()=>showView('cronograma'));
$('themeToggle').addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');try{localStorage.setItem('tjsp-theme',dark?'dark':'light')}catch{}});

setupPlanControls();render();renderDisc();
// Atalho por URL: index.html#desempenho abre direto a aba (útil como favorito no celular).
if(labels[location.hash.slice(1)])showView(location.hash.slice(1));
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
