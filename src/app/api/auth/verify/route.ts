import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { token } = await req.json() as { token: string };

  // Call your Worker's D1 verification endpoint
  const dbRes = await fetch('https://aether.aetherord.workers.dev/api/db/users/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });

  if (!dbRes.ok) {
    return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 400 });
  }

  return NextResponse.json({ message: 'Email verified successfully. You can now log in.' });
}
