import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.tsx';
import { AuthPage } from './pages/Auth.tsx';
import { HomePage } from './pages/Home.tsx';

// Cada tela é baixada quando aberta: quem entra só na tela Hoje não carrega o leitor de PDF, o painel de administração etc.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const AccountPage = page(() => import('./pages/Account.tsx'), 'AccountPage');
const FirstPasswordPage = page(() => import('./pages/Account.tsx'), 'FirstPasswordPage');
const AdminPage = page(() => import('./pages/Admin.tsx'), 'AdminPage');
const DiscursivePage = page(() => import('./pages/Discursive.tsx'), 'DiscursivePage');
const FeedbackPage = page(() => import('./pages/Feedback.tsx'), 'FeedbackPage');
const MaterialsPage = page(() => import('./pages/Materials.tsx'), 'MaterialsPage');
const NewNoticePage = page(() => import('./pages/NewNotice.tsx'), 'NewNoticePage');
const NoticeComparePage = page(() => import('./pages/NoticeCompare.tsx'), 'NoticeComparePage');
const NoticesPage = page(() => import('./pages/Notices.tsx'), 'NoticesPage');
const QuestionsHubPage = page(() => import('./pages/QuestionsHub.tsx'), 'QuestionsHubPage');
const SimuladoPage = page(() => import('./pages/Simulado.tsx'), 'SimuladoPage');
const QuestionnairePage = page(() => import('./pages/Questionnaire.tsx'), 'QuestionnairePage');
const ReadingPage = page(() => import('./pages/Reading.tsx'), 'ReadingPage');
const ReviewPage = page(() => import('./pages/Review.tsx'), 'ReviewPage');
const ReviewsPage = page(() => import('./pages/Reviews.tsx'), 'ReviewsPage');
const SchedulePage = page(() => import('./pages/Schedule.tsx'), 'SchedulePage');
const StudyPage = page(() => import('./pages/Study.tsx'), 'StudyPage');
const VerticalizedPage = page(() => import('./pages/Verticalized.tsx'), 'VerticalizedPage');

const Loading = () => <div className="center-page"><div className="spinner" /></div>;

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <AuthPage />;
  if (session.user.user_metadata.must_change_password) return <Suspense fallback={<Loading />}><FirstPasswordPage /></Suspense>;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/conta" element={<AccountPage />} />
        <Route path="/relatos" element={<FeedbackPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/concursos" element={<NoticesPage />} />
        <Route path="/concursos/novo" element={<NewNoticePage />} />
        <Route path="/concursos/:noticeId/leitura/:jobId" element={<ReadingPage />} />
        <Route path="/concursos/:noticeId/conferencia" element={<ReviewPage />} />
        <Route path="/concursos/:noticeId/questionario" element={<QuestionnairePage />} />
        <Route path="/concursos/:noticeId/comparar" element={<NoticeComparePage />} />
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
    </Suspense>
  );
}
