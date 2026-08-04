import { NextResponse } from 'next/server';
import { authenticator } from 'otplib/authenticator';

export async function POST(req: Request) {
  const { userId } = await req.json();
  const secret = authenticator.generateSecret();
  return NextResponse.json({
    secret,
    qrUrl: `otpauth://totp/Aether:${userId}?secret=${secret}&issuer=Aether`
  });
}