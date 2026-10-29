import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
const cfg=window.TJSP_CONFIG||{};
const app=window.TJSP;
const $=id=>document.getElementById(id);
const status=(message,ok=false)=>{$('syncStatus').textContent=message;$('syncStatus').className='status '+(ok?'ok':'warning')};
// JSON com chaves ordenadas, para comparar estados sem depender da ordem de inserção.
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){$('cloudSetup').textContent='Modo local: configure config.js e publique em HTTPS para ativar a sincronização.';$('authArea').classList.add('hidden')}
else {
  const db=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  $('cloudSetup').textContent='Entre com sua conta para sincronizar seus estudos.';
  let user=null,timer=null,running=null,again=false;
  const setUI=()=>{$('authArea').classList.toggle('hidden',!!user);$('loggedArea').classList.toggle('hidden',!user);$('syncNow').classList.toggle('hidden',!user);$('userInfo').textContent=user?`Conectado como ${user.email}`:''};
  // Busca a nuvem, mescla com o estado local atual e envia o resultado se houver diferença.
  async function sync(){
    if(!user)return;
    if(running){again=true;return running}
    clearTimeout(timer);timer=null;
    running=(async()=>{
      status('Sincronizando...');
      const {data,error}=await db.from('study_progress').select('data').eq('user_id',user.id).maybeSingle();
      if(error){status('Falha ao carregar: '+error.message);return false}
      const cloud=data?app.normalize(data.data):null;
      const merged=app.merge(app.getState(),cloud||{});
      app.apply(merged);
      if(cloud&&stable(cloud)===stable(merged)){status('Sincronizado.',true);return true}
      const {error:saveError}=await db.from('study_progress').upsert({user_id:user.id,data:merged,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(saveError){status('Falha ao salvar: '+saveError.message);return false}
      status('Salvo na nuvem.',true);return true;
    })();
    try{return await running}finally{running=null;if(again){again=false;sync()}}
  }
  window.queueCloudSave=()=>{if(!user)return;status('Alterações aguardando sincronização...');clearTimeout(timer);timer=setTimeout(sync,1500)};
  $('syncNow').onclick=sync;
  async function login(create){const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6){status('Informe e-mail e senha com pelo menos 6 caracteres.');return}status('Aguarde...');const {data,error}=create?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});if(error){status(error.message);return}if(create&&!data.session){status('Conta criada. Confirme o e-mail enviado pelo Supabase e depois entre.');return}status('Autenticado.',true)}
  $('signIn').onclick=()=>login(false);$('signUp').onclick=()=>login(true);
  $('signOut').onclick=async()=>{await sync();await db.auth.signOut();user=null;setUI();status('Sessão encerrada. Dados locais permanecem neste navegador.')};
  async function onAuth(session){
    const next=session?.user||null;if(user?.id===next?.id)return;
    user=next;setUI();
    if(!user){status('Entre para sincronizar seus dados.');return}
    // Evita misturar, sem perguntar, dados de outra conta que usou este navegador.
    let last=null;try{last=localStorage.getItem('tjsp-user')}catch{}
    if(last&&last!==user.id&&!confirm('Este navegador tem dados de outra conta. Mesclar esses dados com a conta atual? (Cancelar começa só com os dados desta conta.)'))app.apply({});
    try{localStorage.setItem('tjsp-user',user.id)}catch{}
    await sync();
  }
  const {data}=await db.auth.getSession();await onAuth(data.session);
  db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>onAuth(session),0)});
  window.addEventListener('online',sync);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'||timer)sync()});
}
