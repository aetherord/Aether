import { NextResponse } from 'next/server';
import otplib from 'otplib';

export async function POST(req: Request) {
  const body = await req.json() as { userId: string };
  const { userId } = body;
  const secret = otplib.authenticator.generateSecret();
  return NextResponse.json({
    secret,
    qrUrl: otpauth://totp/Aether:?secret=&issuer=Aether
  });
}
