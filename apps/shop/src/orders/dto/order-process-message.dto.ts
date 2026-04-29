import { randomUUID } from 'node:crypto';

import { ORDER_PROCESS_QUEUE, ORDERS_SERVICE_PRODUCER } from '@/rabbitmq/constants';

export class OrderProcessMessageDto {
  attempt: number;
  correlationId?: string;
  createdAt?: string;
  eventName?: string;
  messageId?: string;
  orderId?: string;
  producer?: string;
  raw?: unknown;
  trafficSource?: string;

  constructor(orderId: string, correlationId?: string, messageId?: string, trafficSource?: string) {
    this.messageId = messageId ?? randomUUID();
    this.orderId = orderId;
    this.createdAt = new Date().toISOString();
    this.attempt = 1;
    this.correlationId = correlationId ?? randomUUID();
    this.producer = ORDERS_SERVICE_PRODUCER;
    this.eventName = ORDER_PROCESS_QUEUE;
    this.trafficSource = trafficSource;
  }
}
