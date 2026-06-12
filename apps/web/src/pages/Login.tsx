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
      <form onSubmit={submit} className="card w-80 space-y-4 p-6">
        <div className="text-center text-lg font-bold">
          Trader <span className="text-accent">Pro XL+</span>
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
        <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
          Connexion
        </button>
      </form>
    </div>
  )
}
