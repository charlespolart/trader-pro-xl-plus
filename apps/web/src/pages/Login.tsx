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
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-[340px] max-w-full">
        <div className="mb-5 flex items-center gap-3">
          <span className="bg-accent px-2.5 py-1 font-mono text-sm font-extrabold tracking-[0.04em] text-[#201404]">TPX</span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-600">accumulation terminal</span>
        </div>
        <form onSubmit={submit} className="card mt-2.5 space-y-4 p-6">
          <div className="pane-title">Connexion</div>
          <label className="label" htmlFor="pw">
            Mot de passe
          </label>
          <input
            id="pw"
            type="password"
            autoFocus
            className="input num"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error !== '' && <div className="border border-down/40 bg-down/10 px-3 py-2 text-[13px] text-down">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Connexion…' : 'Entrer'}
          </button>
        </form>
      </div>
    </div>
  )
}
