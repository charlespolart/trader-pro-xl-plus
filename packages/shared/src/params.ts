import type { Interval } from './market'

interface ParamBase {
  /** UI label; falls back to the param key */
  label?: string
  description?: string
  /** UI grouping (collapsible sections in the bot config form) */
  group?: string
  /** collapsed by default in the UI */
  advanced?: boolean
}

export type ParamDef =
  | (ParamBase & { kind: 'int'; default: number; min?: number; max?: number; step?: number })
  | (ParamBase & { kind: 'number'; default: number; min?: number; max?: number; step?: number })
  | (ParamBase & { kind: 'bool'; default: boolean })
  | (ParamBase & { kind: 'select'; default: string; options: readonly string[] })
  | (ParamBase & { kind: 'interval'; default: Interval; options?: readonly Interval[] })
  | (ParamBase & { kind: 'string'; default: string })

export type ParamSchema = Record<string, ParamDef>

export type ParamValue = number | boolean | string
export type ParamValues = Record<string, ParamValue>

export function defaultParams(schema: ParamSchema): ParamValues {
  const out: ParamValues = {}
  for (const [key, def] of Object.entries(schema)) out[key] = def.default
  return out
}

export interface ParamValidation {
  ok: boolean
  errors: string[]
  /** coerced + clamped values, complete (missing keys filled with defaults) */
  values: ParamValues
}

export function validateParams(schema: ParamSchema, input: ParamValues): ParamValidation {
  const errors: string[] = []
  const values: ParamValues = {}

  for (const [key, def] of Object.entries(schema)) {
    const raw = input[key]
    if (raw === undefined || raw === null || raw === '') {
      values[key] = def.default
      continue
    }
    switch (def.kind) {
      case 'int':
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(n)) {
          errors.push(`${key}: expected a number, got ${JSON.stringify(raw)}`)
          values[key] = def.default
          break
        }
        let v = def.kind === 'int' ? Math.round(n) : n
        if (def.min !== undefined && v < def.min) {
          errors.push(`${key}: ${v} < min ${def.min} (clamped)`)
          v = def.min
        }
        if (def.max !== undefined && v > def.max) {
          errors.push(`${key}: ${v} > max ${def.max} (clamped)`)
          v = def.max
        }
        values[key] = v
        break
      }
      case 'bool':
        values[key] = typeof raw === 'boolean' ? raw : raw === 'true' || raw === 1
        break
      case 'select': {
        const s = String(raw)
        if (!def.options.includes(s)) {
          errors.push(`${key}: '${s}' is not one of [${def.options.join(', ')}]`)
          values[key] = def.default
        } else {
          values[key] = s
        }
        break
      }
      case 'interval': {
        const s = String(raw)
        const allowed = def.options ?? null
        if (allowed && !allowed.includes(s as Interval)) {
          errors.push(`${key}: '${s}' is not one of [${allowed.join(', ')}]`)
          values[key] = def.default
        } else {
          values[key] = s
        }
        break
      }
      case 'string':
        values[key] = String(raw)
        break
    }
  }

  const unknown = Object.keys(input).filter((k) => !(k in schema))
  for (const k of unknown) errors.push(`${k}: unknown parameter`)

  return { ok: errors.length === 0, errors, values }
}
