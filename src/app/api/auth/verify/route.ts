import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { token } = await req.json();
  // TODO: Check D1 for token, mark user as verified
  return NextResponse.json({ message: 'Email verified.' });
}
