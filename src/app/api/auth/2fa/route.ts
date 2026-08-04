import { NextResponse } from 'next/server';
import { authenticator } from 'otplib';

export async function POST(req: Request) {
  const { userId } = await req.json();
  const secret = authenticator.generateSecret();
  // TODO: Save secret to D1 for user, return QR code URL
  return NextResponse.json({ 
    secret, 
    qrUrl: otpauth://totp/Aether:?secret=&issuer=Aether 
  });
}
