// src/services/Email.service.ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { injectable } from "inversify";

@injectable()
export default class EmailService {

  private ses = new SESv2Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  async sendVerificationEmail(to: string, link: string) {
    const from = process.env.EMAIL_FROM!;

    await this.ses.send(new SendEmailCommand({
      FromEmailAddress: `Goood-Vibez <${from}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: "Verify your email" },
          Body: {
            Html: {
              Data: `
                <p>Welcome! Please confirm your email:</p>
                <p><a href="${link}">Verify Email</a></p>
                <p>This link expires in 24 hours.</p>`,
            },
          },
        },
      },
    }));

  }
}
