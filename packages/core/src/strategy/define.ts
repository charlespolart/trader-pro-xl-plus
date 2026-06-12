import { isInterval, type MarketType, type ParamValues } from '@tpx/shared'
import type { FeedSpecMap, StrategyDefinition, StrategyHooks } from './types'
import { toParamSchema, type InferParams, type ParamBuilders } from './params'

export interface StrategyInput<S extends ParamBuilders, L> extends StrategyHooks<InferParams<S>, L> {
  name: string
  description?: string
  /** markets this strategy supports; defaults to both */
  markets?: MarketType[]
  params: S
  /**
   * Data subscriptions. Must include a 'main' candle feed (it drives
   * ctx.candles / warmup). Defaults to { main: { interval: params.interval } }
   * when the schema has an 'interval' param.
   */
  data?: (params: InferParams<S>) => FeedSpecMap
}

export function defineStrategy<S extends ParamBuilders, L = Record<string, never>>(
  input: StrategyInput<S, L>,
): StrategyDefinition {
  const dataFn = input.data as ((p: ParamValues) => FeedSpecMap) | undefined

  const data = (params: ParamValues): FeedSpecMap => {
    if (dataFn) return dataFn(params)
    const itv = params['interval']
    if (typeof itv === 'string' && isInterval(itv)) {
      return { main: { interval: itv } }
    }
    throw new Error(
      `Strategy '${input.name}': declare data() or add an 'interval' param so the main feed can be inferred`,
    )
  }

  return {
    name: input.name,
    description: input.description,
    markets: input.markets ?? ['spot', 'futures'],
    schema: toParamSchema(input.params),
    data,
    hooks: {
      init: input.init,
      onCandle: input.onCandle,
      onTrade: input.onTrade,
      onFill: input.onFill,
      onOrderUpdate: input.onOrderUpdate,
      onFunding: input.onFunding,
      onStop: input.onStop,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as StrategyHooks<any, any>,
  }
}
