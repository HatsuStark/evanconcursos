'use strict';
const KEY='tjsp2027';
const START=new Date(2026,10,2),EXAM=new Date(2027,2,14);
const subjects=['Processo Penal','Direito Penal','Direito Civil','Processo Civil','Normas da Corregedoria','Constitucional e Administrativo','Português','Matemática e RL','Informática','Atualidades'];
// Conhecimentos específicos recebem um pouco mais de peso na priorização.
const CORE=new Set(['Processo Penal','Direito Penal','Direito Civil','Processo Civil','Normas da Corregedoria']);
const topics=[
['Fundamentos de Penal e Processo Penal',['CPP arts. 24–42: ação penal','CP arts. 1–12: aplicação da lei penal','CC arts. 1–25 e 40–45: pessoas','CPC arts. 1–11, 13–18 e 203–211','Português: interpretação; 15 questões','CPP arts. 61–74: competência; diagnóstico','Normas CGJ arts. 994–1005; revisão']],
['Provas, crimes e personalidade',['CPP arts. 112, 125–131 e 156','CP arts. 100–120: ação penal e punibilidade','CC arts. 49–50, 53, 62 e 70–103','CPC arts. 212–235 e 269–275','Matemática: porcentagem e proporções','CPP arts. 185, 202–204 e 218–225; discursiva','Normas CGJ arts. 1006–1015']],
['Busca e apreensão, penhora e crimes',['CPP arts. 240–250: busca e apreensão','CP arts. 121, 129, 150 e 154','CC arts. 115–120 e 138–159','CPC arts. 827–846: penhora','Português: concordância e regência','CPP arts. 274 e 283–303: prisões','Normas CGJ arts. 1016–1025']],
['Mandados criminais e nulidades',['CPP arts. 351–363 e 370–372','CP arts. 293–305, 307–308 e 311-A','CC arts. 166–184','CPC arts. 36, 42–53 e 64–66','Informática: Windows e Word','CPP arts. 396–396-A e 406; discursiva','Normas CGJ arts. 1026–1035']],
['Crimes funcionais e prescrição',['CPP arts. 436–446 e 485–487','CP arts. 312–317 e 319–333','CC arts. 185–201 e 212–215','CPC arts. 70–85 e 98–102','CF arts. 1–5','CPP arts. 513–518 e 563–570','Normas CGJ arts. 1036–1045']],
['Execução civil e revisão penal',['CPP arts. 593 e 647–654','CP arts. 336–337, 339–347, 357 e 359','CC arts. 653–666','CPC arts. 535–536, 538, 782, 795 e 806–807','Português: crase e pontuação','CPP arts. 762–763, 792 e 798; Lei 9.099/95; discursiva','Normas CGJ arts. 1046–1055']],
['Posse, garantias e diligências',['CPP: revisão de buscas, prisões e citações','CP: revisão de crimes funcionais','CC arts. 1169–1173 e 1196–1203','CPC arts. 554, 560–563, 626, 695 e 751','Matemática: médias e juros simples','CC arts. 1431–1451: garantias; discursiva','Normas CGJ arts. 1056–1065']],
['Conclusão de Civil e CPC',['CPP: 20 questões de prisões e comunicações','CP: 20 questões de fé pública','CC arts. 1461, 1467–1472, 1728, 1767–1778 e 1997','CPC arts. 870–875 e 447–454','CF arts. 6–16 e 18','LINDB: leitura e revisão de Civil','Normas CGJ arts. 1066–1075']],
['Fechamento inicial do edital',['CPC arts. 110–111, 125–161 e 176–199','CPC arts. 236–259, 502 e 528','CPC arts. 994–1022: recursos','CF arts. 37–41 e 92–99','Informática: Excel','Lei 9.099/95 arts. 8–9 e 18–19','Normas CGJ arts. 1076–1085']],
['Administrativo e legislação especial',['Lei 10.261/68 arts. 1–78 selecionados','Lei 10.261/68 arts. 110–251 selecionados','Lei 8.429/92 arts. 9 e 13','CF arts. 125, 127 e 134','Português: coesão e pontuação','Lei 6.830/80: execução fiscal','Normas CGJ arts. 1086–1091-A']],
['Normas especiais e consolidação',['Resolução CNJ 354/2020 arts. 1 e 8–10','Lei 11.608/2003: custas','Normas CGJ arts. 1–4, 33, 47, 49 e 105–110','Normas CGJ arts. 196, 282, 310, 315 e 410','Matemática: geometria e gráficos','Normas CGJ arts. 436–440-A; discursiva','Normas CGJ arts. 1137–1139, 1245 e 1247']],
['Segunda passagem: matérias iniciantes',['CPP: ação penal, competência e medidas','CP: punibilidade e crimes contra pessoa','CC: pessoas, bens e prescrição','CPC: comunicações e execução','Português: 20 questões','CPP: buscas e prisões; duas discursivas','Normas CGJ: mapa de procedimentos']],
['Primeiro simulado integral',['CP: crimes contra Administração','CPP: procedimentos e recursos','CC: mandato, posse e garantias','CPC: penhora e avaliação','Constitucional e Administrativo','Simulado de 70 questões + 2 discursivas','Correção e ranking de erros']],
['Reforço de Penal e CPP',['CPP: 3 assuntos com maior erro','CP: 3 assuntos com maior erro','CC: pontos fracos','CPC: execução e mandados','Raciocínio lógico: proposições','40 questões de Penal/CPP + discursiva','Normas CGJ: caderno de erros']],
['Reforço de Civil e Normas',['CC: 25 questões','CPC: 25 questões','Normas CGJ: Capítulo VII','Legislação especial','Português: 15 questões','Segundo simulado integral + 2 discursivas','Correção e revisão']],
['Revisão integral e velocidade',['CPP: 30 questões','CP: 30 questões','CC: 25 questões','CPC e Normas: 25 questões','Informática: Word, Excel e internet','Constitucional e Administrativo; discursivas','Atualidades e revisão']],
['Simulado e reta final',['CPP e CP: lei seca dos erros','CPC: execução e penhora','CC: pessoas, negócios e posse','Normas CGJ: Capítulo VII','Português e Matemática: 25 questões','Terceiro simulado integral + discursivas','Correção e revisão de Atualidades']],
['Revisão final por desempenho',['CPP: mandados, buscas e prisões','CP: crimes funcionais e fé pública','CC: artigos marcados','CPC e Normas: diligências','Português e Informática','Último simulado integral + discursivas','Correção final']],
['Consolidação e descanso',['CPP: revisão leve','CP e CC: mapa de erros','CPC e Normas: artigos essenciais','Português e fórmulas','Discursivas e logística','Revisão leve e descanso','14/03: PROVA']]
];
const weekdays=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const TOTAL_TASKS=topics.length*7;
const $=id=>document.getElementById(id);
const pct=(c,t)=>Math.round(c/t*100);

// ---------- Estado: validação e mesclagem ----------
// Cada alteração guarda um carimbo de tempo; exclusões viram "tombstones" em `deleted`.
// Assim dois dispositivos podem ser mesclados sem que um apague o progresso do outro.
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function hash(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return (h>>>0).toString(36)}
function parseBR(d){const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d||'');return m?new Date(+m[3],m[2]-1,+m[1]).getTime():0}
function isQcUrl(u){try{const x=new URL(u);return x.protocol==='https:'&&(x.hostname==='qconcursos.com'||x.hostname.endsWith('.qconcursos.com'))}catch{return false}}

function normalize(raw){
  raw=plain(raw);
  const s={v:2,tasks:{},taskTimes:{},goals:{},records:[],notes:String(raw.notes||''),notesTime:num(raw.notesTime),discursivas:[],deleted:{},qcLinks:{},updatedAt:num(raw.updatedAt)};
  for(const [k,v] of Object.entries(plain(raw.goals))){const g=plain(v),n=Number(g.n);if(/^\d+-\d+$/.test(k)&&Number.isInteger(n)&&n>0&&n<=500)s.goals[k]={n,ts:num(g.ts)}}
  for(const [k,v] of Object.entries(plain(raw.tasks)))if(/^\d+-\d+$/.test(k))s.tasks[k]=!!v;
  for(const [k,v] of Object.entries(plain(raw.taskTimes)))if(k in s.tasks)s.taskTimes[k]=num(v);
  for(const [k,v] of Object.entries(plain(raw.deleted)))s.deleted[k]=num(v);
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
    const taskId=/^\d+-\d+$/.test(r.taskId)?r.taskId:'',theme=String(r.theme||'').slice(0,200);
    records.set(id,{id,subject,assunto,correct,total,date,ts:num(r.ts)||parseBR(date),taskId,theme});
  }
  const discs=new Map();
  for(const d of Array.isArray(raw.discursivas)?raw.discursivas:[]){
    if(!d||typeof d!=='object'||!d.title)continue;
    const score=d.score===null||d.score===undefined||d.score===''?null:Number(d.score);
    const id=typeof d.id==='string'&&d.id?d.id:'d-'+hash(String(d.title)+'|'+String(d.date));
    discs.set(id,{id,title:String(d.title),answer:String(d.answer||''),score:Number.isFinite(score)&&score>=0&&score<=10?score:null,subject:String(d.subject||''),date:String(d.date||''),ts:num(d.ts)||parseBR(d.date)});
  }
  for(const [k,v] of Object.entries(plain(raw.qcLinks))){const l=plain(v),url=String(l.url||'');if(url===''||isQcUrl(url))s.qcLinks[k]={url,ts:num(l.ts)}}
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
  for(const s of [a,b])for(const [k,v] of Object.entries(s.qcLinks))if(!m.qcLinks[k]||v.ts>m.qcLinks[k].ts)m.qcLinks[k]=v;
  for(const s of [a,b])for(const [k,v] of Object.entries(s.goals))if(!m.goals[k]||v.ts>m.goals[k].ts)m.goals[k]=v;
  m.updatedAt=Math.max(a.updatedAt,b.updatedAt);
  return m;
}

let state;
try{state=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch{state=normalize({})}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
function save(){state.updatedAt=Date.now();persist();window.queueCloudSave?.()}

// ---------- Foco adaptativo ----------
// Acerto suavizado: começa em 70% (peso de 10 questões) e os resultados decaem com meia-vida de 30 dias.
const PRIOR=.7,PRIOR_WEIGHT=10,HALF_LIFE_DAYS=30;
function analyze(){
  const now=Date.now(),bySubject={},byTopic={};
  const add=(map,key,r,w,extra)=>{const e=map[key]||(map[key]={subject:r.subject,c:0,t:0,cw:0,tw:0,...extra});e.c+=r.correct;e.t+=r.total;e.cw+=r.correct*w;e.tw+=r.total*w};
  for(const r of state.records){
    const w=r.ts?Math.pow(.5,Math.max(0,now-r.ts)/864e5/HALF_LIFE_DAYS):.5;
    add(bySubject,r.subject,r,w);
    if(r.assunto)add(byTopic,r.subject+'|'+r.assunto.toLowerCase(),r,w,{assunto:r.assunto});
  }
  const priority=e=>(1-(e.cw+PRIOR*PRIOR_WEIGHT)/(e.tw+PRIOR_WEIGHT))*(CORE.has(e.subject)?1.2:1);
  const rows=subjects.map(s=>{const e=bySubject[s]||{subject:s,c:0,t:0,cw:0,tw:0};return {...e,priority:priority(e)}}).sort((x,y)=>y.priority-x.priority);
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
function qcUrl(subject,assunto,mode,acc){
  const own=state.qcLinks[subject]?.url,base=state.qcLinks._base?.url;
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
// Cada tarefa vira um tema de questões: matéria (pelo prefixo), palavra-chave (texto após ":") e meta.
const SUBJECT_RULES=[
  [/^CPP\b/,'Processo Penal'],[/^CPC\b|^Lei 6\.830|^Lei 9\.099/,'Processo Civil'],[/^CP\b|Penal\/CPP/,'Direito Penal'],
  [/^CC\b|^LINDB/,'Direito Civil'],[/^Normas CGJ|^Lei 11\.608/,'Normas da Corregedoria'],
  [/^(CF\b|Lei 10\.261|Lei 8\.429|Resolução CNJ|Constitucional|Legislação especial)/,'Constitucional e Administrativo'],
  [/^Português/,'Português'],[/^(Matemática|Raciocínio)/,'Matemática e RL'],[/^Informática/,'Informática'],[/^Atualidades/,'Atualidades'],
];
const WEAK_MARK='*fracos*';
function taskKeyword(text){
  const i=text.indexOf(':');if(i<0)return '';
  let k=text.slice(i+1).split(';')[0].trim()
    .replace(/^\d+\s+questões\s*(de\s+)?/i,'').replace(/^revisão\s+(leve\s*)?(de\s+)?/i,'');
  // Tarefas de reforço ("3 assuntos com maior erro", "pontos fracos"...) usam o assunto mais fraco do momento.
  if(/erro|fracos|marcados|essenciais/i.test(k))return WEAK_MARK;
  k=k.split(',')[0].trim();
  return k.length>2&&!/^\d|mapa|cap[ií]tulo|diligências|logística|fórmulas/i.test(k)?k:'';
}
function taskInfo(id){
  const [w,d]=id.split('-').map(Number),text=topics[w]?.[1][d]||'';
  const subject=(SUBJECT_RULES.find(([re])=>re.test(text))||[])[1]||'';
  const parsed=Number((/(\d+)\s+questões/.exec(text)||[])[1]);
  const goal=state.goals[id]?.n||(parsed||(d===5?30:20));
  return {id,text,subject,keyword:subject?taskKeyword(text):'',goal,theme:'task:'+id,week:w,day:d};
}
const DAY_MS=864e5;
const startOfDay=ts=>new Date(ts).setHours(0,0,0,0);
function todayInfo(){
  const d=Math.round((startOfDay(Date.now())-START.getTime())/DAY_MS),idx=Math.max(0,Math.min(TOTAL_TASKS-1,d));
  return {...taskInfo(Math.floor(idx/7)+'-'+idx%7),before:d<0,after:d>=TOTAL_TASKS};
}
const themeKey=r=>r.theme||(r.assunto?r.subject+'|'+r.assunto.toLowerCase():'');
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
function reviewQueue(){
  const groups=new Map();
  for(const r of state.records){const k=themeKey(r);if(k){if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}}
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
  const box=document.createElement('div');box.className='practice';
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
  where.textContent=`${subject}${kw?' · assunto: '+kw:''}`+(state.qcLinks[subject]?.url?'':state.qcLinks._base?.url?' · filtro base (salve o link da matéria para filtrar pela disciplina)':' · sem filtro salvo: busca só por palavra-chave');
  const links=document.createElement('div');links.className='actions';
  const diffAcc=t>=10?acc:null;
  links.append(linkButton({label:'Resolver questões',href:qcUrl(subject,kw,'not_resolved',diffAcc)}));
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
    state.records.push({id:crypto.randomUUID(),subject,assunto:kw||'',correct:a,total:a+e,date:new Date().toLocaleDateString('pt-BR'),ts:Date.now(),taskId:taskId||'',theme});
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
function currentWeek(){return Math.max(0,Math.min(topics.length-1,Math.floor((new Date()-START)/604800000)))}
topics.forEach((t,i)=>week.add(new Option(`Semana ${i+1} · ${new Date(2026,10,2+i*7).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,i)));
week.value=currentWeek();
subjects.forEach(s=>$('subject').add(new Option(s)));

function renderWeek(){
  const n=Number(week.value);
  $('focus').textContent=topics[n][0];
  const today=todayInfo().id;
  $('daysList').replaceChildren(...topics[n][1].map((task,i)=>{
    const id=n+'-'+i,info=taskInfo(id),card=document.createElement('div'),label=document.createElement('label'),cb=document.createElement('input'),wrap=document.createElement('div'),head=document.createElement('strong'),text=document.createElement('div');
    card.className='day'+(id===today?' today':'');label.className='day-top';cb.type='checkbox';cb.checked=!!state.tasks[id];
    cb.onchange=()=>{state.tasks[id]=cb.checked;state.taskTimes[id]=Date.now();save();render()};
    head.textContent=weekdays[i]+' · '+(i===5?'3h':'2h')+(id===today?' · hoje':'');
    text.textContent=task;text.className=cb.checked?'done':'';
    wrap.append(head,text);label.append(cb,wrap);card.append(label);
    if(info.subject){
      // Hoje: bloco aberto. Demais dias: recolhido, com o resumo no título.
      const {c,t}=themeStats(info.theme);
      const det=document.createElement('details'),sum=document.createElement('summary');
      sum.textContent=`Questões · meta ${info.goal}`+(t?` · ${t} feitas (${pct(c,t)}%)`:'');
      det.open=id===today;det.append(sum,practiceBlock(info));card.append(det);
    }
    return card;
  }));
}
function renderHome(){
  const completed=Object.values(state.tasks).filter(Boolean).length;
  $('done').textContent=completed;
  $('progress').max=TOTAL_TASKS;$('progress').value=completed;
  $('progressLabel').textContent=`${completed} de ${TOTAL_TASKS} tarefas concluídas`;
  $('days').textContent=Math.max(0,Math.ceil((EXAM-new Date())/86400000));
  const c=state.records.reduce((s,r)=>s+r.correct,0),t=state.records.reduce((s,r)=>s+r.total,0);
  $('accuracy').textContent=t?pct(c,t)+'%':'—';
}
function renderPerformance(){
  const {rows}=analyze();
  // Hoje: a tarefa do dia do cronograma, pronta para resolver e registrar.
  const today=todayInfo(),todayBox=$('todayPanel');
  const head=document.createElement('p');head.className='muted';
  head.textContent=(today.before?`O plano começa em ${START.toLocaleDateString('pt-BR')}. Primeira tarefa — `:today.after?'Plano concluído. Última tarefa — ':'')+`Semana ${today.week+1}, ${weekdays[today.day]}: ${today.text}`;
  if(today.subject)todayBox.replaceChildren(head,practiceBlock(today));
  else{const n=document.createElement('p');n.className='note';n.textContent='Tarefa sem questões por matéria (simulado, correção ou descanso). Registre os resultados por matéria no formulário abaixo.';todayBox.replaceChildren(head,n)}
  // Reforço: temas fracos em revisão espaçada; primeiro os vencidos.
  const queue=reviewQueue(),endToday=startOfDay(Date.now())+DAY_MS;
  const due=queue.filter(q=>q.due<endToday);
  $('reviewList').replaceChildren(...(queue.length?queue.map(q=>{
    const div=document.createElement('div');div.className='focus-item'+(q.due<endToday?' due':'');
    const late=Math.floor((startOfDay(Date.now())-q.due)/DAY_MS);
    const when=document.createElement('div');when.className='note';
    when.textContent=(q.due<endToday?(late>0?`Atrasada há ${late} dia(s)`:'Revisar hoje'):`Próxima revisão em ${new Date(q.due).toLocaleDateString('pt-BR')}`)+
      ` · revisão ${q.stage+1} de ${REVIEW_DAYS.length} (sugestão: 10 questões) · último dia: ${q.last.c}/${q.last.t} (${pct(q.last.c,q.last.t)}%)`;
    div.append(practiceBlock({subject:q.subject,keyword:q.keyword,theme:q.key,goal:0,label:q.label}),when);
    return div;
  }):[Object.assign(document.createElement('p'),{className:'muted',textContent:'Nenhum tema em reforço. Temas com menos de 75% de acerto aparecem aqui automaticamente.'})]));
  const todayStats=today.subject?themeStats(today.theme):{t:0};
  $('homeFocus').textContent=`Hoje: ${today.text}`+(today.subject?` · ${todayStats.t} de ${today.goal} questões`:'')+(due.length?` · ${due.length} revisão(ões) pendente(s)`:'');
  const maxP=Math.max(...rows.map(r=>r.priority),.01);
  $('subjectTable').replaceChildren(...rows.map(r=>{
    const tr=document.createElement('tr'),bar=document.createElement('div'),fill=document.createElement('span');
    bar.className='bar';fill.style.width=Math.round(r.priority/maxP*100)+'%';bar.append(fill);
    const cells=[r.subject,String(r.t),r.t?pct(r.c,r.t)+'%':'—'];
    cells.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i)td.className='num';tr.append(td)});
    const td=document.createElement('td');td.append(bar);tr.append(td);return tr;
  }));
  const list=$('records');
  if(!state.records.length){list.textContent='Nenhum registro ainda.';}
  else list.replaceChildren(...state.records.slice(-15).reverse().map(r=>{
    const row=document.createElement('div'),text=document.createElement('span'),del=document.createElement('button');
    row.className='record';
    text.textContent=`${r.date} · ${r.subject}${r.assunto?' ('+r.assunto+')':''}: ${r.correct}/${r.total} (${pct(r.correct,r.total)}%)`;
    del.className='secondary small';del.textContent='Excluir';del.setAttribute('aria-label','Excluir registro de '+r.subject);
    del.onclick=()=>{if(!confirm('Excluir este registro?'))return;state.deleted[r.id]=Date.now();state.records=state.records.filter(x=>x.id!==r.id);save();render()};
    row.append(text,del);return row;
  }));
  const used=[...new Set(state.records.filter(r=>r.assunto&&r.subject===$('subject').value).map(r=>r.assunto))];
  $('assuntos').replaceChildren(...used.map(a=>new Option(a)));
}
function renderLinks(){
  $('linkCfg').replaceChildren(...[['_base','Filtro base do concurso (banca, cargo, anos) — vale para todas as matérias'],...subjects.map(s=>[s,s])].map(([key,text])=>{
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='url';input.dataset.subject=key;input.placeholder='https://www.qconcursos.com/questoes-de-concursos/questoes?...';input.value=state.qcLinks[key]?.url||'';
    label.append(text,input);return label;
  }));
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

// ---------- Eventos ----------
week.onchange=renderWeek;
$('today').onclick=()=>{week.value=currentWeek();renderWeek()};
$('subject').onchange=renderPerformance;
$('add').onclick=()=>{
  const c=Number($('correct').value||0),w=Number($('wrong').value||0);
  if(!Number.isInteger(c)||!Number.isInteger(w)||c<0||w<0||c+w<1)return alert('Informe quantas acertou e quantas errou.');
  state.records.push({id:crypto.randomUUID(),subject:$('subject').value,assunto:$('assunto').value.trim().slice(0,120),correct:c,total:c+w,date:new Date().toLocaleDateString('pt-BR'),ts:Date.now()});
  $('assunto').value='';$('correct').value='';$('wrong').value='';save();render();
};
$('saveLinks').onclick=()=>{
  const inputs=[...$('linkCfg').querySelectorAll('input')];
  const bad=inputs.filter(i=>i.value.trim()&&!isQcUrl(i.value.trim()));
  if(bad.length){$('linkStatus').textContent='Link inválido em: '+bad.map(i=>i.dataset.subject).join(', ')+'. Use um endereço https do qconcursos.com.';return}
  for(const i of inputs){const url=i.value.trim();if(url!==(state.qcLinks[i.dataset.subject]?.url||''))state.qcLinks[i.dataset.subject]={url,ts:Date.now()}}
  save();renderPerformance();$('linkStatus').textContent='Links salvos.';
};
const notes=$('notes');
notes.value=state.notes;
notes.oninput=()=>{state.notes=notes.value;state.notesTime=Date.now();save()};
$('discAdd').onclick=()=>{
  const title=$('discTitle').value.trim(),answer=$('discAnswer').value.trim(),raw=$('discScore').value,score=raw===''?null:Number(raw);
  if(!title||!answer||score!==null&&(!Number.isFinite(score)||score<0||score>10))return alert('Preencha tema e resposta; nota entre 0 e 10.');
  state.discursivas.push({id:crypto.randomUUID(),title,answer,score,subject:$('discSubject').value,date:new Date().toLocaleDateString('pt-BR'),ts:Date.now()});
  $('discTitle').value='';$('discAnswer').value='';$('discScore').value='';save();renderDisc();
};
$('export').onclick=()=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
  a.download=`tjsp-progresso-${new Date().toISOString().slice(0,10)}.json`;a.click();
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
    const prevLinks=JSON.stringify(state.qcLinks);
    state=normalize(next);persist();
    if(notes.value!==state.notes)notes.value=state.notes;
    render();renderDisc();
    if(JSON.stringify(state.qcLinks)!==prevLinks)renderLinks();
  },
};

// ---------- Navegação e tema ----------
const labels={inicio:'Visão geral',cronograma:'Cronograma',desempenho:'Desempenho',discursivas:'Discursivas',conta:'Minha conta'};
function showView(v){
  if(!labels[v])return;
  document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!=='view-'+v);
  document.querySelectorAll('[data-view]').forEach(e=>{const active=e.dataset.view===v;e.classList.toggle('active',active);e.setAttribute('aria-current',active?'page':'false')});
  $('pageTitle').textContent=labels[v];window.scrollTo(0,0);
}
document.querySelectorAll('[data-view],[data-go]').forEach(e=>e.addEventListener('click',()=>showView(e.dataset.view||e.dataset.go)));
$('goWeek').addEventListener('click',()=>showView('cronograma'));
$('themeToggle').addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');try{localStorage.setItem('tjsp-theme',dark?'dark':'light')}catch{}});

render();renderDisc();renderLinks();
// Atalho por URL: index.html#desempenho abre direto a aba (útil como favorito no celular).
if(labels[location.hash.slice(1)])showView(location.hash.slice(1));
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
