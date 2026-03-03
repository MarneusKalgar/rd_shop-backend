import { randomUUID } from 'node:crypto';

export class OrderProcessMessageDto {
  attempt: number;
  correlationId: string;
  createdAt: string;
  eventName: string;
  messageId: string;
  orderId: string;
  producer: string;

  constructor(orderId: string, correlationId?: string) {
    this.messageId = randomUUID();
    this.orderId = orderId;
    this.createdAt = new Date().toISOString();
    this.attempt = 1;
    this.correlationId = correlationId ?? randomUUID();
    this.producer = 'orders-service';
    this.eventName = 'order.process';
  }
}
