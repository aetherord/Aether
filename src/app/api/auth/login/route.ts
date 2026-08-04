import { NextResponse } from 'next/server';
import { authenticator } from 'otplib';

// Helper: pretend this returns a user from D1
// Replace this with actual D1 fetch logic later
async function getUserByUsername(username: string) {
  // TODO: Query D1 for user by username
  return null; // placeholder
}

export async function POST(req: Request) {
  const { username, password, totpCode } = await req.json();

  // 1. Fetch user from D1
  const user = await getUserByUsername(username);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 2. Check password (placeholder — add bcrypt compare here)
  const passwordMatches = true; // replace with actual bcrypt check
  if (!passwordMatches) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // 3. Check if email is verified
  if (!user.is_verified) {
    return NextResponse.json({ 
      error: 'Please verify your email before logging in.',
      requiresVerification: true 
    }, { status: 403 });
  }

  // 4. Check if 2FA is enabled
  if (user.totp_secret) {
    // If they didn't provide a totpCode, ask for it
    if (!totpCode) {
      return NextResponse.json({ 
        requires2FA: true,
        message: '2FA is enabled. Please provide your 6-digit code.'
      }, { status: 200 });
    }

    // Verify the 6-digit code
    const isValid = authenticator.check(totpCode, user.totp_secret);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
    }
  }

  // 5. All checks passed — return success
  return NextResponse.json({ 
    success: true, 
    message: 'Logged in successfully.',
    user: { id: user.id, username: user.username }
  });
}
