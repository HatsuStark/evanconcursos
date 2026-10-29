// Aplica o tema antes da renderização para evitar piscar. Sem preferência salva, segue o sistema.
(function(){
  let saved=null;
  try{saved=localStorage.getItem('tjsp-theme')}catch{}
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  const apply=()=>document.documentElement.classList.toggle('dark',saved?saved==='dark':media.matches);
  apply();
  media.addEventListener('change',()=>{try{saved=localStorage.getItem('tjsp-theme')}catch{}apply()});
})();
