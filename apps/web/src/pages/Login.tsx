import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={submit} className="card w-80 space-y-5 p-7">
        <div className="text-center">
          <div className="text-xl font-bold tracking-tight">
            Trader <span className="text-accent">Pro XL+</span>
          </div>
          <div className="mt-1 text-sm text-zinc-500">Connexion à votre espace</div>
        </div>
        <input
          type="password"
          autoFocus
          className="input"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error !== '' && <div className="text-sm text-down">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          Connexion
        </button>
      </form>
    </div>
  )
}
