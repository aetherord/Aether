import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { email, username, verificationToken } = await req.json() as { email: string; username: string; verificationToken: string };

  const verificationLink = `https://aetherord.pages.dev/verify-email?token=${verificationToken}`;

  const htmlContent = `
    <div style="background-color: #0a0a0a; color: #ffffff; font-family: 'Inter', sans-serif; padding: 40px 20px; text-align: center;">
      <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 24px; padding: 40px; border: 1px solid #333;">
        <div style="font-family: 'Playfair Display', serif; font-size: 48px; font-style: italic; font-weight: bold; color: #ffffff; margin-bottom: 20px;">A</div>
        <h1 style="font-size: 28px; font-weight: 500; margin: 0 0 10px 0;">Welcome to Aether, ${username}!</h1>
        <p style="color: #a0a0a0; font-size: 16px; margin-bottom: 30px;">Click the button below to verify your email address and start using Aether.</p>
        <a href="${verificationLink}" style="display: inline-block; background-color: #ffffff; color: #000000; padding: 14px 32px; border-radius: 9999px; text-decoration: none; font-weight: 600; font-size: 16px; transition: background 0.3s;">
          Verify Email
        </a>
        <p style="color: #666666; font-size: 12px; margin-top: 30px;">If you didn't create this account, you can safely ignore this email.</p>
        <div style="border-top: 1px solid #333; margin-top: 30px; padding-top: 20px; color: #555; font-size: 11px;">
          Aether · The future of community chat
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: 'aether.verify@outlook.com', name: 'Aether' },
        to: [{ email }],
        subject: 'Welcome to Aether – Verify your email',
        htmlContent: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || 'Email failed');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Brevo error:', error);
    return NextResponse.json({ error: 'Email failed' }, { status: 500 });
  }
}
