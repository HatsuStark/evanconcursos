import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg=window.TJSP_CONFIG||{};
const $=id=>document.getElementById(id);
const status=(message,ok=false)=>{ $('syncStatus').textContent=message;$('syncStatus').className='status '+(ok?'ok':'warning') };
if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){$('cloudSetup').textContent='Modo local: configure config.js e publique em HTTPS para ativar a sincronização.';$('authArea').classList.add('hidden')}
else {
  const db=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  $('cloudSetup').textContent='Entre com sua conta para sincronizar seus estudos.';
  let user=null,timer=null,dirty=false,saving=false;
  const local=()=>JSON.parse(localStorage.getItem('tjsp2027')||'{}');
  const setUI=()=>{$('authArea').classList.toggle('hidden',!!user);$('loggedArea').classList.toggle('hidden',!user);$('syncNow').classList.toggle('hidden',!user);$('userInfo').textContent=user?`Conectado como ${user.email}`:''};
  async function loadCloud(){if(!user)return;status('Carregando progresso da nuvem...');const {data,error}=await db.from('study_progress').select('data').eq('user_id',user.id).maybeSingle();if(error){status('Falha ao carregar: '+error.message);return}if(data){window.applyCloudState(data.data);status('Progresso sincronizado.',true)}else{status('Conta nova: o progresso local ainda não foi enviado. Clique em Sincronizar agora.')}}
  async function saveCloud(){if(!user||saving)return;saving=true;clearTimeout(timer);status('Salvando na nuvem...');const snapshot=local();const {error}=await db.from('study_progress').upsert({user_id:user.id,data:snapshot,updated_at:new Date().toISOString()},{onConflict:'user_id'});saving=false;if(error){dirty=true;status('Falha de sincronização: '+error.message)}else{dirty=false;status('Salvo na nuvem.',true)}}
  window.queueCloudSave=()=>{if(!user)return;dirty=true;status('Alterações aguardando sincronização...');clearTimeout(timer);timer=setTimeout(saveCloud,850)};
  $('syncNow').onclick=saveCloud;
  async function login(create){const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6){status('Informe e-mail e senha com pelo menos 6 caracteres.');return}status('Aguarde...');const {data,error}=create?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});if(error){status(error.message);return}if(create&&!data.session){status('Conta criada. Confirme o e-mail enviado pelo Supabase e depois entre.');return}status('Autenticado.',true)}
  $('signIn').onclick=()=>login(false);$('signUp').onclick=()=>login(true);
  $('signOut').onclick=async()=>{if(dirty)await saveCloud();await db.auth.signOut();user=null;setUI();status('Sessão encerrada. Dados locais permanecem neste navegador.')};
  async function onAuth(session){const next=session?.user||null;if(user?.id===next?.id)return;user=next;setUI();if(user)await loadCloud();else status('Entre para sincronizar seus dados.');}
  const {data}=await db.auth.getSession();await onAuth(data.session);
  db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>onAuth(session),0)});
  window.addEventListener('online',()=>{if(dirty)saveCloud()});
}
