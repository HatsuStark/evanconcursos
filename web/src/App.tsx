import { Route, Routes } from 'react-router-dom';

// Fluxo do primeiro acesso. Cada passo ganha sua tela nas próximas etapas (E1–E4).
const ONBOARDING = ['Cadastro', 'Envio do edital', 'Conferência dos dados', 'Questionário', 'Geração do cronograma', 'Estudo diário'];

function Home() {
  return (
    <main className="page">
      <header className="brand">
        <span className="logo" aria-hidden>§</span>
        <h1>Evan Concursos</h1>
      </header>
      <section className="panel">
        <h2>Em construção</h2>
        <p className="muted">Envie o edital, responda algumas perguntas e receba um cronograma personalizado, com orientação diária, materiais, revisões e questões.</p>
        <ol className="steps">
          {ONBOARDING.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
