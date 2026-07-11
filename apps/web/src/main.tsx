import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/fira-code' // la donnée chiffrée porte l'identité (auto-hébergée, pas de requête externe)
import App from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
})

// La molette au-dessus d'un <input type="number"> incrémente/décrémente la
// valeur (comportement navigateur) — sur un formulaire de trading c'est un
// levier ou une quantité qui change sans qu'on s'en rende compte en scrollant
// la page. Neutralisé GLOBALEMENT (couvre tous les champs actuels et futurs).
// passive:false est requis pour pouvoir preventDefault un événement wheel.
document.addEventListener(
  'wheel',
  (e) => {
    const t = e.target
    if (t instanceof HTMLInputElement && t.type === 'number') {
      e.preventDefault()
      t.blur() // rend le scroll de page au prochain cran de molette
    }
  },
  { passive: false, capture: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
