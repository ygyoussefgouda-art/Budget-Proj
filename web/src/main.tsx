import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverlayProvider } from './components/Overlays';
import { UpdateBar } from './components/UpdateBar';
import { watchGlobalErrors } from './errors';
import { clearKit } from './offline';
import { I18nProvider } from './i18n';
// Fonts are bundled with the app: no Google request, works offline.
import '@fontsource-variable/manrope'; // body text
import '@fontsource/montserrat/700.css'; // headings (Montserrat Bold)
import '@fontsource-variable/cairo'; // Arabic letters (Manrope/Montserrat have none)
import './styles.css';
import { registerServiceWorker } from './swUpdate';
import { applyTheme, watchSystemTheme } from './theme';

applyTheme();
watchSystemTheme();
watchGlobalErrors();

// Any 401 (expired session, password changed, signed out elsewhere) sends the user back to the login screen,
// and forgets that account's cached data so the next person to sign in on this phone never sees it.
const onError = (e: unknown) => {
  if (!(e instanceof ApiError && e.status === 401)) return;
  clearKit();
  queryClient.setQueryData(['me'], null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <I18nProvider>
            <OverlayProvider>
              <App />
              <UpdateBar />
            </OverlayProvider>
          </I18nProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// New versions download in the background; the app asks before switching (UpdateBar).
if (import.meta.env.PROD) registerServiceWorker();
