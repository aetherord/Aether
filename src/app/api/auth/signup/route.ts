import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function POST(req: Request) {
  const { username, email, password } = await req.json() as { username: string; email: string; password: string };

  // 1. Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  // 2. Insert into D1 (using your D1 binding)
  // Since we are in a static export, we call the Worker API directly
  const dbRes = await fetch('https://aether.aetherord.workers.dev/api/db/users/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, passwordHash: hashedPassword, verificationToken })
  });

  if (!dbRes.ok) {
    return NextResponse.json({ error: 'Username or email already exists' }, { status: 400 });
  }

  // 3. Send verification email via Brevo
  await fetch('https://aether.aetherord.workers.dev/api/auth/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, verificationToken })
  });

  return NextResponse.json({ message: 'Account created. Check your email to verify.' });
}
