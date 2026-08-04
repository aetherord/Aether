import { NextResponse } from 'next/server';

export function middleware(req: Request) {
  const url = new URL(req.url);
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || '';

  if (url.pathname.startsWith('/chat')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }
  return NextResponse.next();
}