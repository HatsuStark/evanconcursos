'use strict';
// Planos de estudo: cada edital vira um plano (dados), e o app trabalha sempre sobre o plano ativo.
// Formato usado para salvar, importar/exportar e, nas próximas etapas, para o gerador e a IA preencherem:
// {id, name, cargo, banca, examDate:'AAAA-MM-DD'|'', startDate:'AAAA-MM-DD',
//  subjects:[{name, core}],                       core = conhecimento específico (pesa mais no foco)
//  weeks:[{title, days:[{text, hours, subject, keyword, goal} × 7]}],
//  config:{...},                                   respostas do gerador (generator.js), guardadas para refazer
//  notes:[...]}                                    observações do edital (nota mínima, discursiva...)
// subject vazio = dia sem questões por matéria (simulado, correção, descanso).
const DEFAULT_PLAN_ID='tjsp-oj-2027';
const WEAK_MARK='*fracos*';
const PLAN_ID_RE=/^[a-z0-9-]{1,40}$/;
// typeof antes do regex: test(undefined) testaria o texto "undefined" e passaria.
const isPlanId=v=>typeof v==='string'&&PLAN_ID_RE.test(v);

const pad2=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
function parseYmd(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(+m[1],m[2]-1,+m[3]):null}
function slugify(s){return String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'plano'}
const clip=(v,max)=>String(v??'').trim().slice(0,max);

function normalizePlan(raw){
  raw=raw&&typeof raw==='object'?raw:{};
  const subjects=[],seen=new Set();
  for(const s of Array.isArray(raw.subjects)?raw.subjects:[]){
    const name=clip(typeof s==='string'?s:s?.name,60);
    if(name&&!seen.has(name)){seen.add(name);subjects.push({name,core:!!s?.core})}
  }
  const weeks=(Array.isArray(raw.weeks)?raw.weeks:[]).slice(0,104).map((w,i)=>({
    title:clip(w?.title,120)||`Semana ${i+1}`,
    days:Array.from({length:7},(_,d)=>{
      const x=w?.days?.[d]||{},hours=Number(x.hours),goal=Number(x.goal),subject=clip(x.subject,60);
      return {text:clip(x.text,200),hours:Number.isFinite(hours)&&hours>=0&&hours<=16?hours:0,
        subject:seen.has(subject)?subject:'',keyword:clip(x.keyword,80),goal:Number.isInteger(goal)&&goal>0&&goal<=500?goal:0};
    }),
  }));
  const ts=Number(raw.ts);
  return {id:isPlanId(raw.id)?raw.id:slugify(raw.name||'plano'),name:clip(raw.name,80)||'Plano sem nome',
    cargo:clip(raw.cargo,80),banca:clip(raw.banca,40),examDate:parseYmd(raw.examDate)?raw.examDate:'',
    startDate:parseYmd(raw.startDate)?raw.startDate:ymd(new Date()),subjects,weeks,ts:Number.isFinite(ts)?ts:0,
    // Validado de verdade em normalizeConfig (generator.js), quando usado.
    config:raw.config&&typeof raw.config==='object'&&!Array.isArray(raw.config)?JSON.parse(JSON.stringify(raw.config)):null,
    notes:(Array.isArray(raw.notes)?raw.notes:[]).map(n=>clip(n,300)).filter(Boolean).slice(0,30)};
}

// ---------- Plano embutido: TJSP Oficial de Justiça 2027 ----------
// Escrito como texto; matéria, palavra-chave e meta são derivadas abaixo.
const TJSP_WEEKS=[
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
['Consolidação e descanso',['CPP: revisão leve','CP e CC: mapa de erros','CPC e Normas: artigos essenciais','Português e fórmulas','Discursivas e logística','Revisão leve e descanso','14/03: PROVA']],
];
const TJSP_SUBJECT_RULES=[
  [/^CPP\b/,'Processo Penal'],[/^CPC\b|^Lei 6\.830|^Lei 9\.099/,'Processo Civil'],[/^CP\b|Penal\/CPP/,'Direito Penal'],
  [/^CC\b|^LINDB/,'Direito Civil'],[/^Normas CGJ|^Lei 11\.608/,'Normas da Corregedoria'],
  [/^(CF\b|Lei 10\.261|Lei 8\.429|Resolução CNJ|Constitucional|Legislação especial)/,'Constitucional e Administrativo'],
  [/^Português/,'Português'],[/^(Matemática|Raciocínio)/,'Matemática e RL'],[/^Informática/,'Informática'],[/^Atualidades/,'Atualidades'],
];
// Palavra-chave para o filtro do QConcursos: o texto após ":", só o primeiro termo.
function taskKeyword(text){
  const i=text.indexOf(':');if(i<0)return '';
  let k=text.slice(i+1).split(';')[0].trim()
    .replace(/^\d+\s+questões\s*(de\s+)?/i,'').replace(/^revisão\s+(leve\s*)?(de\s+)?/i,'');
  // Tarefas de reforço ("3 assuntos com maior erro", "pontos fracos"...) usam o assunto mais fraco do momento.
  if(/erro|fracos|marcados|essenciais/i.test(k))return WEAK_MARK;
  k=k.split(',')[0].trim();
  return k.length>2&&!/^\d|mapa|cap[ií]tulo|diligências|logística|fórmulas/i.test(k)?k:'';
}
const BUILTIN_PLANS={
  [DEFAULT_PLAN_ID]:normalizePlan({
    id:DEFAULT_PLAN_ID,name:'TJSP · Oficial de Justiça 2027',cargo:'Oficial de Justiça',banca:'VUNESP',
    examDate:'2027-03-14',startDate:'2026-11-02',
    subjects:['Processo Penal','Direito Penal','Direito Civil','Processo Civil','Normas da Corregedoria'].map(name=>({name,core:true}))
      .concat(['Constitucional e Administrativo','Português','Matemática e RL','Informática','Atualidades'].map(name=>({name,core:false}))),
    weeks:TJSP_WEEKS.map(([title,days])=>({title,days:days.map((text,d)=>{
      const subject=(TJSP_SUBJECT_RULES.find(([re])=>re.test(text))||[])[1]||'';
      const n=Number((/(\d+)\s+questões/.exec(text)||[])[1]);
      return {text,hours:d===5?3:2,subject,keyword:subject?taskKeyword(text):'',goal:subject&&n?n:0};
    })})),
  }),
};
