import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import { useAuth } from './lib/auth.tsx';
import { AuthPage } from './pages/Auth.tsx';
import { HomePage } from './pages/Home.tsx';
import { NewNoticePage } from './pages/NewNotice.tsx';
import { NoticesPage } from './pages/Notices.tsx';
import { ReadingPage } from './pages/Reading.tsx';
import { ReviewPage } from './pages/Review.tsx';

function Soon({ title, stage }: { title: string; stage: string }) {
  return (
    <Shell title={title}>
      <div className="glass card"><span className="badge orange">{stage}</span><p className="muted" style={{ marginBottom: 0 }}>Esta área chega numa das próximas etapas.</p></div>
    </Shell>
  );
}

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-page"><div className="spinner" /></div>;
  if (!session) return <AuthPage />;
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/concursos" element={<NoticesPage />} />
      <Route path="/concursos/novo" element={<NewNoticePage />} />
      <Route path="/concursos/:noticeId/leitura/:jobId" element={<ReadingPage />} />
      <Route path="/concursos/:noticeId/conferencia" element={<ReviewPage />} />
      <Route path="/cronograma" element={<Soon title="Cronograma" stage="E3" />} />
      <Route path="/desempenho" element={<Soon title="Desempenho" stage="E5" />} />
      <Route path="/discursivas" element={<Soon title="Discursivas" stage="E5" />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
