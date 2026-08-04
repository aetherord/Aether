import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  // TODO: Insert user into D1, generate verification token, send email via Resend/Brevo
  return NextResponse.json({ message: 'User created. Check your email to verify.' });
}
