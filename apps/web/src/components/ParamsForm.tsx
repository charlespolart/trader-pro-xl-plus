import { INTERVALS, type ParamDef, type ParamSchema, type ParamValues } from '@tpx/shared'
import { Field } from './ui'

interface Props {
  schema: ParamSchema
  values: ParamValues
  onChange: (values: ParamValues) => void
}

/** Auto-generated strategy parameter form, grouped by `group`. */
export function ParamsForm({ schema, values, onChange }: Props) {
  const groups = new Map<string, [string, ParamDef][]>()
  for (const [key, def] of Object.entries(schema)) {
    const g = def.group ?? 'Paramètres'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push([key, def])
  }

  const set = (key: string, v: ParamValues[string]) => onChange({ ...values, [key]: v })

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([group, defs]) => (
        <div key={group}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{group}</div>
          <div className="columns-2 gap-x-3">
            {defs.map(([key, def]) => (
              <div key={key} className="mb-3 break-inside-avoid">
                <ParamField name={key} def={def} value={values[key] ?? def.default} onChange={(v) => set(key, v)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ParamField({ name, def, value, onChange }: { name: string; def: ParamDef; value: ParamValues[string]; onChange: (v: ParamValues[string]) => void }) {
  const label = def.label ?? name
  switch (def.kind) {
    case 'int':
    case 'number':
      return (
        <Field label={label} hint={def.description}>
          <input
            type="number"
            className="input"
            value={String(value)}
            min={def.min}
            max={def.max}
            step={def.step ?? (def.kind === 'int' ? 1 : 'any')}
            onChange={(e) => onChange(e.target.value === '' ? def.default : Number(e.target.value))}
          />
        </Field>
      )
    case 'bool':
      return (
        <label className="flex cursor-pointer items-center gap-2 py-2 text-sm text-zinc-300">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="accent-blue-500" />
          {label}
        </label>
      )
    case 'select':
      return (
        <Field label={label} hint={def.description}>
          <select className="input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {def.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      )
    case 'interval':
      return (
        <Field label={label} hint={def.description}>
          <select className="input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {(def.options ?? INTERVALS).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      )
    case 'string':
      return (
        <Field label={label} hint={def.description}>
          <input type="text" className="input" value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </Field>
      )
  }
}
