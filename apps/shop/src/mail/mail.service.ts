import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly appUrl: string;
  private readonly fromAddress: string;
  private readonly logger = new Logger(MailService.name);
  private readonly sesClient: null | SESv2Client;

  constructor(private readonly configService: ConfigService) {
    const sesRegion = this.configService.get<string>('AWS_SES_REGION');
    this.fromAddress = this.configService.get<string>('SES_FROM_ADDRESS', 'noreply@rdshop.com');
    this.appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');

    if (sesRegion) {
      this.sesClient = new SESv2Client({ region: sesRegion });
    } else {
      this.sesClient = null;
      this.logger.warn('AWS_SES_REGION is not set — emails will be logged to console (dev mode)');
    }
  }

  async sendOrderCancellationEmail(email: string, orderId: string): Promise<void> {
    if (!this.sesClient) {
      this.logger.log(`[DEV] Order cancellation email for ${email}: orderId=${orderId}`);
      return;
    }

    await this.sesClient.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: `Your order #${orderId} has been cancelled.\n\nIf you did not request this cancellation, please contact support.`,
              },
            },
            Subject: { Data: `Order #${orderId} has been cancelled` },
          },
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: this.fromAddress,
      }),
    );
  }

  async sendOrderConfirmationEmail(email: string, orderId: string): Promise<void> {
    if (!this.sesClient) {
      this.logger.log(`[DEV] Order confirmation email for ${email}: orderId=${orderId}`);
      return;
    }

    await this.sesClient.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: `Thank you for your order! Your order #${orderId} has been successfully placed and is being processed.\n\nYou will receive a payment confirmation once your order has been processed.`,
              },
            },
            Subject: { Data: `Order #${orderId} confirmed` },
          },
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: this.fromAddress,
      }),
    );
  }

  async sendOrderPaidEmail(email: string, orderId: string): Promise<void> {
    if (!this.sesClient) {
      this.logger.log(`[DEV] Order paid email for ${email}: orderId=${orderId}`);
      return;
    }

    await this.sesClient.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: `Great news! Payment has been confirmed for your order #${orderId}.\n\nYour order is now being prepared for shipment.`,
              },
            },
            Subject: { Data: `Payment confirmed for order #${orderId}` },
          },
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: this.fromAddress,
      }),
    );
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    if (!this.sesClient) {
      this.logger.log(`[DEV] Password reset email for ${email}: ${link}`);
      return;
    }

    await this.sesClient.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: `You requested a password reset. Click the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you did not request this, please ignore this email.`,
              },
            },
            Subject: { Data: 'Reset your password' },
          },
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: this.fromAddress,
      }),
    );
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/verify-email?token=${encodeURIComponent(token)}`;

    if (!this.sesClient) {
      this.logger.log(`[DEV] Verification email for ${email}: ${link}`);
      return;
    }

    await this.sesClient.send(
      new SendEmailCommand({
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: `Please verify your email address by clicking the link below:\n\n${link}\n\nThis link expires in 24 hours.`,
              },
            },
            Subject: { Data: 'Verify your email address' },
          },
        },
        Destination: { ToAddresses: [email] },
        FromEmailAddress: this.fromAddress,
      }),
    );
  }
}
