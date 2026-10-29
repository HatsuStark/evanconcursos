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
  const s={v:2,tasks:{},taskTimes:{},records:[],notes:String(raw.notes||''),notesTime:num(raw.notesTime),discursivas:[],deleted:{},qcLinks:{},updatedAt:num(raw.updatedAt)};
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
    records.set(id,{id,subject,assunto,correct,total,date,ts:num(r.ts)||parseBR(date)});
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
// Parte do link salvo da matéria (disciplina, banca etc.) e ajusta só o que o foco precisa:
// `q` = palavra-chave do assunto e `my_questions` = not_resolved (novas) ou wrong (que errei).
const QC_QUESTIONS='https://www.qconcursos.com/questoes-de-concursos/questoes';
function qcUrl(subject,assunto,mode){
  const saved=state.qcLinks[subject]?.url;
  const url=new URL(saved||QC_QUESTIONS);
  const p=url.searchParams;
  const keyword=assunto||(saved?'':subject);
  if(keyword)p.set('q',keyword);
  p.set('my_questions',mode);
  p.set('exclude_nullified','true');
  p.set('exclude_outdated','true');
  p.delete('page');
  return url.href;
}
function linkButton({href,label},secondary){const a=document.createElement('a');a.className='button'+(secondary?' secondary':'');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;return a}

// ---------- Renderização ----------
const week=$('week');
function currentWeek(){return Math.max(0,Math.min(topics.length-1,Math.floor((new Date()-START)/604800000)))}
topics.forEach((t,i)=>week.add(new Option(`Semana ${i+1} · ${new Date(2026,10,2+i*7).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,i)));
week.value=currentWeek();
subjects.forEach(s=>$('subject').add(new Option(s)));

function renderWeek(){
  const n=Number(week.value);
  $('focus').textContent=topics[n][0];
  $('daysList').replaceChildren(...topics[n][1].map((task,i)=>{
    const id=n+'-'+i,label=document.createElement('label'),cb=document.createElement('input'),wrap=document.createElement('div'),head=document.createElement('strong'),text=document.createElement('div');
    label.className='day';cb.type='checkbox';cb.checked=!!state.tasks[id];
    cb.onchange=()=>{state.tasks[id]=cb.checked;state.taskTimes[id]=Date.now();save();render()};
    head.textContent=weekdays[i]+' · '+(i===5?'3h':'2h');
    text.textContent=task;text.className=cb.checked?'done':'';
    wrap.append(head,text);label.append(cb,wrap);return label;
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
  const {rows,weakTopics}=analyze();
  // Foco sugerido: três matérias prioritárias, cada uma com o assunto mais fraco quando houver.
  const focus=rows.slice(0,3).map(row=>({row,topic:weakTopics.find(tp=>tp.subject===row.subject)}));
  $('focusList').replaceChildren(...focus.map(({row,topic},i)=>{
    const div=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('div'),actions=document.createElement('div');
    div.className='focus-item';meta.className='muted';actions.className='actions';
    title.textContent=`${i+1}. ${row.subject}`;
    meta.textContent=(row.t?`${pct(row.c,row.t)}% de acerto em ${row.t} questões`:'Sem registros ainda')+(topic?` · assunto mais fraco: ${topic.assunto} (${pct(topic.c,topic.t)}%)`:'');
    actions.append(
      linkButton({label:'Questões novas',href:qcUrl(row.subject,topic?.assunto,'not_resolved')}),
      linkButton({label:'Refazer as que errei',href:qcUrl(row.subject,topic?.assunto,'wrong')},true));
    div.append(title,meta,actions);
    if(!state.qcLinks[row.subject]?.url){const tip=document.createElement('div');tip.className='note';tip.textContent='Sem filtro salvo para esta matéria: a busca usa só palavra-chave, sem limitar à VUNESP.';div.append(tip)}
    return div;
  }));
  const top=focus[0];
  $('homeFocus').textContent=state.records.length?`Próximo foco: ${top.row.subject}${top.topic?' — '+top.topic.assunto:''}.`:'Registre suas primeiras questões para receber um foco personalizado.';
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
  $('linkCfg').replaceChildren(...subjects.map(s=>{
    const label=document.createElement('label'),input=document.createElement('input');
    input.type='url';input.dataset.subject=s;input.placeholder='https://www.qconcursos.com/questoes-de-concursos/questoes?...';input.value=state.qcLinks[s]?.url||'';
    label.append(s,input);return label;
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
  const c=Number($('correct').value),t=Number($('total').value);
  if(!Number.isInteger(c)||!Number.isInteger(t)||t<1||c<0||c>t)return alert('Informe valores válidos.');
  state.records.push({id:crypto.randomUUID(),subject:$('subject').value,assunto:$('assunto').value.trim().slice(0,120),correct:c,total:t,date:new Date().toLocaleDateString('pt-BR'),ts:Date.now()});
  $('assunto').value='';save();render();
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
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
