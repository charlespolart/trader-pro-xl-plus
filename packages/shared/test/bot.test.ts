import { describe, expect, it } from 'bun:test'
import { effectiveCredentialName } from '../src/bot'

describe('effectiveCredentialName', () => {
  it('paper = aucun compte réel', () => {
    expect(effectiveCredentialName('paper')).toBeNull()
    expect(effectiveCredentialName('paper', 'tpxportfolio')).toBeNull()
  })

  it('compat historique : sans credentialName, le mode choisit le compte', () => {
    expect(effectiveCredentialName('live')).toBe('live')
    expect(effectiveCredentialName('live', null)).toBe('live')
    expect(effectiveCredentialName('testnet')).toBe('testnet')
    expect(effectiveCredentialName('testnet', undefined)).toBe('testnet')
  })

  it('credentialName explicite prime sur le défaut du mode', () => {
    expect(effectiveCredentialName('live', 'tpxportfolio')).toBe('tpxportfolio')
    expect(effectiveCredentialName('testnet', 'sandbox2')).toBe('sandbox2')
  })

  it('deux bots ne partagent un compte que si leurs noms effectifs coïncident', () => {
    // le bot historique (NULL) et un bot explicitement sur 'live' = même compte
    expect(effectiveCredentialName('live', null)).toBe(effectiveCredentialName('live', 'live'))
    // deux sous-comptes distincts = jamais le même scope
    expect(effectiveCredentialName('live', 'sub-a')).not.toBe(effectiveCredentialName('live', 'sub-b'))
  })
})
