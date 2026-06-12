import type { Interval, ParamDef, ParamSchema, ParamValues } from '@tpx/shared'

interface CommonOpts {
  label?: string
  description?: string
  group?: string
  advanced?: boolean
}

/**
 * A ParamDef carrying its TypeScript value type as a phantom, so that
 * defineStrategy can infer a fully typed ctx.params from the schema.
 */
export type ParamBuilder<T> = ParamDef & { readonly __t?: T }

export const p = {
  int: (opts: CommonOpts & { default: number; min?: number; max?: number; step?: number }): ParamBuilder<number> => ({
    kind: 'int',
    ...opts,
  }),

  number: (opts: CommonOpts & { default: number; min?: number; max?: number; step?: number }): ParamBuilder<number> => ({
    kind: 'number',
    ...opts,
  }),

  /** convenience: a number expressed in percent (UI shows the % suffix) */
  percent: (opts: CommonOpts & { default: number; min?: number; max?: number; step?: number }): ParamBuilder<number> => ({
    kind: 'number',
    min: 0,
    step: 0.1,
    ...opts,
    label: opts.label ? `${opts.label} (%)` : undefined,
  }),

  bool: (opts: CommonOpts & { default: boolean }): ParamBuilder<boolean> => ({
    kind: 'bool',
    ...opts,
  }),

  select: <const O extends readonly string[]>(
    opts: CommonOpts & { options: O; default: O[number] },
  ): ParamBuilder<O[number]> => ({
    kind: 'select',
    ...opts,
  }),

  interval: (opts: CommonOpts & { default: Interval; options?: readonly Interval[] }): ParamBuilder<Interval> => ({
    kind: 'interval',
    ...opts,
  }),

  string: (opts: CommonOpts & { default: string }): ParamBuilder<string> => ({
    kind: 'string',
    ...opts,
  }),
}

export type ParamBuilders = Record<string, ParamBuilder<unknown>>

export type InferParams<S extends ParamBuilders> = {
  readonly [K in keyof S]: S[K] extends ParamBuilder<infer T> ? T : never
}

export function toParamSchema(builders: ParamBuilders): ParamSchema {
  return builders as ParamSchema
}

export function typedParams<S extends ParamBuilders>(_schema: S, values: ParamValues): InferParams<S> {
  return values as InferParams<S>
}
