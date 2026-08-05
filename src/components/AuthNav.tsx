"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { safeJson } from "@/lib/safeJson";

export default function AuthNav() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => safeJson<{ authenticated?: boolean }>(r))
      .then((data) => {
        if (alive) setAuthed(Boolean(data.authenticated));
      })
      .catch(() => {
        if (alive) setAuthed(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = async () => {
    await fetch("/api/auth/session", { method: "POST" });
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <div className="flex items-center gap-4">
        <div className="h-9 w-20 rounded-full bg-white/10 animate-pulse" />
      </div>
    );
  }

  if (authed) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href="/settings"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Settings
        </Link>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm rounded-full border border-white/20 text-gray-300 hover:text-white hover:border-white/50 transition-all duration-300"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
        Log in
      </Link>
      <Link
        href="/signup"
        className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium border border-transparent hover:bg-transparent hover:text-white hover:border-white/50 transition-all duration-300"
      >
        Get started
      </Link>
    </div>
  );
}
