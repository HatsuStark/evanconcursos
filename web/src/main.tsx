import '@fontsource-variable/outfit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { applyAppearance, loadAppearance, watchSystemTheme } from './lib/appearance.ts';
import { AuthProvider } from './lib/auth.tsx';
import './styles.css';

// Depois de uma publicação, a aba aberta ainda aponta para arquivos de tela que não existem mais: recarrega uma vez.
window.addEventListener('vite:preloadError', () => {
  try {
    if (sessionStorage.getItem('reloaded-for-update')) return;
    sessionStorage.setItem('reloaded-for-update', '1');
  } catch { return; }
  window.location.reload();
});

applyAppearance(loadAppearance());
watchSystemTheme();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
