"use client";
import { useEffect, useState } from 'react';

export default function Chat() {
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('aether_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }
    fetch('https://aether.aetherord.workers.dev/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then((res) => res.json() as Promise<{ verified: boolean }>)
      .then((data) => {
        if (data.verified) {
          setIsVerified(true);
        } else {
          window.location.href = '/login';
        }
      });
  }, []);

  if (!isVerified) return <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">Checking access...</div>;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      <h1 className="text-3xl font-serif mb-6">Aether Chat</h1>
      <p className="text-gray-400">You are fully verified. Welcome to the chat.</p>
    </div>
  );
}
