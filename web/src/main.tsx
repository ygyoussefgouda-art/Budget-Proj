import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverlayProvider } from './components/Overlays';
import { UpdateBar } from './components/UpdateBar';
import { NativeLayer, UpdateGate, UpdateOffer } from './components/AndroidApp';
import { watchGlobalErrors } from './errors';
import { clearKit } from './offline';
import { idbPersister, KEEP_OFFLINE, OFFLINE_MAX_AGE } from './persist';
import { APP_VERSION } from './version';
import { I18nProvider } from './i18n';
// Fonts are bundled with the app: no Google request, works offline.
import '@fontsource-variable/manrope'; // all Latin text, headings included (2026 redesign)
// Arabic letters (Manrope has none): Almarai, Option E's Arabic face; Arabic subset only, three weights
import '@fontsource/almarai/arabic-400.css';
import '@fontsource/almarai/arabic-700.css';
import '@fontsource/almarai/arabic-800.css';
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
  queryClient.setQueryData(['me'], null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  void clearKit();
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Kept (in memory and in the offline copy) long enough to open the app offline days later.
      gcTime: OFFLINE_MAX_AGE,
      // Try once even when the phone says it's offline; then wait for the connection instead of failing.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: idbPersister,
          maxAge: OFFLINE_MAX_AGE,
          buster: APP_VERSION, // a new version starts with a fresh copy
          dehydrateOptions: {
            shouldDehydrateQuery: (q) => q.state.status === 'success' && KEEP_OFFLINE.has(String(q.queryKey[0])),
          },
        }}
      >
        <BrowserRouter>
          <I18nProvider>
            <OverlayProvider>
              <App />
              <UpdateBar />
              {/* Android app only (each renders nothing in a browser) */}
              <NativeLayer />
              <UpdateOffer />
              <UpdateGate />
            </OverlayProvider>
          </I18nProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// New versions download in the background; the app asks before switching (UpdateBar).
if (import.meta.env.PROD) registerServiceWorker();
