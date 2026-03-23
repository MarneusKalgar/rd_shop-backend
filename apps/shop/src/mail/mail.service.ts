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
