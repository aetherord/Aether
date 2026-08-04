import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export async function POST(req: Request) {
  const { username, password, totpCode } = await req.json();

  // Fetch user from D1 via Worker
  const userRes = await fetch('https://aether.aetherord.workers.dev/api/db/users/get?username=' + username);
  const user = await userRes.json();

  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Check password
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // BLOCK if email is NOT verified
  if (!user.is_verified) {
    return NextResponse.json({
      error: 'Please verify your email before logging in.',
      requiresVerification: true
    }, { status: 403 });
  }

  // Check 2FA
  if (user.totp_secret) {
    if (!totpCode) {
      return NextResponse.json({
        requires2FA: true,
        message: '2FA is enabled. Please provide your 6-digit code.'
      }, { status: 200 });
    }
    // Verify 2FA code
    const isValid = authenticator.check(totpCode, user.totp_secret);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
    }
  }

  // Generate JWT token
  const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET!, {
    expiresIn: '7d'
  });

  return NextResponse.json({
    success: true,
    token,
    user: { id: user.id, username: user.username }
  });
}
