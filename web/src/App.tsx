import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.tsx';
import { AccountPage, FirstPasswordPage } from './pages/Account.tsx';
import { AuthPage } from './pages/Auth.tsx';
import { DiscursivePage } from './pages/Discursive.tsx';
import { HomePage } from './pages/Home.tsx';
import { MaterialsPage } from './pages/Materials.tsx';
import { NewNoticePage } from './pages/NewNotice.tsx';
import { NoticesPage } from './pages/Notices.tsx';
import { QuestionsHubPage } from './pages/QuestionsHub.tsx';
import { SimuladoPage } from './pages/Simulado.tsx';
import { QuestionnairePage } from './pages/Questionnaire.tsx';
import { ReadingPage } from './pages/Reading.tsx';
import { ReviewPage } from './pages/Review.tsx';
import { ReviewsPage } from './pages/Reviews.tsx';
import { SchedulePage } from './pages/Schedule.tsx';
import { StudyPage } from './pages/Study.tsx';
import { VerticalizedPage } from './pages/Verticalized.tsx';

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-page"><div className="spinner" /></div>;
  if (!session) return <AuthPage />;
  if (session.user.user_metadata.must_change_password) return <FirstPasswordPage />;
  return (
    <Routes>
      <Route path="/conta" element={<AccountPage />} />
      <Route path="/" element={<HomePage />} />
      <Route path="/concursos" element={<NoticesPage />} />
      <Route path="/concursos/novo" element={<NewNoticePage />} />
      <Route path="/concursos/:noticeId/leitura/:jobId" element={<ReadingPage />} />
      <Route path="/concursos/:noticeId/conferencia" element={<ReviewPage />} />
      <Route path="/concursos/:noticeId/questionario" element={<QuestionnairePage />} />
      <Route path="/cronograma" element={<SchedulePage />} />
      <Route path="/edital" element={<VerticalizedPage />} />
      <Route path="/revisoes" element={<ReviewsPage />} />
      <Route path="/estudo/:taskId" element={<StudyPage />} />
      <Route path="/materiais" element={<MaterialsPage />} />
      <Route path="/questoes" element={<QuestionsHubPage />} />
      <Route path="/simulados/:id" element={<SimuladoPage />} />
      <Route path="/desempenho" element={<Navigate to="/questoes?aba=desempenho" replace />} />
      <Route path="/discursivas" element={<DiscursivePage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
