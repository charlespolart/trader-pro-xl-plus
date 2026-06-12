/** Chart annotations emitted by strategies via ctx.annotate(). */
export type ChartAnnotation =
  | {
      type: 'marker'
      time: number
      position: 'above' | 'below' | 'inBar'
      shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
      color?: string
      text?: string
    }
  | {
      type: 'hline'
      price: number
      /** ms timestamps bounding the segment; omit for full-width line */
      from?: number
      to?: number
      color?: string
      style?: 'solid' | 'dashed' | 'dotted'
      label?: string
    }
  | {
      type: 'label'
      time: number
      price: number
      text: string
      color?: string
    }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  time: number
  level: LogLevel
  message: string
  data?: unknown
}
