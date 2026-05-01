export const METRICS_SINK = Symbol('METRICS_SINK');

export interface MetricDefinition {
  name: string;
  unit: MetricUnit;
  value: number;
}

export interface MetricEvent {
  dimensions: Record<string, string>;
  metrics: MetricDefinition[];
  properties?: Record<string, unknown>;
  timestamp?: number;
}

export interface MetricsSink {
  emit(event: MetricEvent): void;
}

export type MetricUnit = 'Count' | 'Milliseconds';
