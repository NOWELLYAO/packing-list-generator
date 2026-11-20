import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// lien de suivi client (…/#s=IDENTIFIANT) : page publique en lecture seule, sans connexion
const shared = window.location.hash.match(/^#s=([A-Z0-9]{20})$/)?.[1]
const SharedView = lazy(() => import('./components/SharedView.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shared ? (
      <Suspense fallback={null}>
        <SharedView id={shared} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
