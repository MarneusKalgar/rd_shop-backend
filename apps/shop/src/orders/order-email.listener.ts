import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { MailService } from '@/mail/mail.service';

import {
  ORDER_CANCELLED_EVENT,
  ORDER_CREATED_EVENT,
  ORDER_PAID_EVENT,
  OrderCancelledEvent,
  OrderCreatedEvent,
  OrderPaidEvent,
} from './events';

@Injectable()
export class OrderEmailListener {
  private readonly logger = new Logger(OrderEmailListener.name);

  constructor(private readonly mailService: MailService) {}

  @OnEvent(ORDER_CANCELLED_EVENT)
  async handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    try {
      await this.mailService.sendOrderCancellationEmail(event.userEmail, event.orderId);
    } catch (error) {
      this.logger.error(
        `Failed to send order cancellation email for order ${event.orderId}`,
        error,
      );
    }
  }

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      await this.mailService.sendOrderConfirmationEmail(event.userEmail, event.orderId);
    } catch (error) {
      this.logger.error(
        `Failed to send order confirmation email for order ${event.orderId}`,
        error,
      );
    }
  }

  @OnEvent(ORDER_PAID_EVENT)
  async handleOrderPaid(event: OrderPaidEvent): Promise<void> {
    try {
      await this.mailService.sendOrderPaidEmail(event.userEmail, event.orderId);
    } catch (error) {
      this.logger.error(`Failed to send order paid email for order ${event.orderId}`, error);
    }
  }
}
