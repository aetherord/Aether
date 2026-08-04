import { NextResponse } from 'next/server';
import otplib from 'otplib';

export async function POST(req: Request) {
  const { userId } = await req.json();
  const secret = otplib.authenticator.generateSecret();
  return NextResponse.json({
    secret,
    qrUrl: `otpauth://totp/Aether:${userId}?secret=${secret}&issuer=Aether`
  });
}
