import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api';
import App from './App';
import { OverlayProvider } from './components/Overlays';
import { I18nProvider } from './i18n';
// Fonts are bundled with the app: no Google request, works offline.
import '@fontsource-variable/manrope'; // body text
import '@fontsource/montserrat/700.css'; // headings (Montserrat Bold)
import '@fontsource-variable/cairo'; // Arabic letters (Manrope/Montserrat have none)
import './styles.css';
import { applyTheme, watchSystemTheme } from './theme';

applyTheme();
watchSystemTheme();

// Any 401 (expired session, password changed) sends the user back to the login screen.
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) queryClient.setQueryData(['me'], null);
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <I18nProvider>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </I18nProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
