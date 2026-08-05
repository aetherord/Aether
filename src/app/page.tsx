import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import Background from "@/components/Background";

/** Little static chat mock so the hero shows the product, not just a tagline. */
function ChatMock() {
  return (
    <div className="glass rounded-3xl overflow-hidden w-full max-w-lg mx-auto text-left">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="ml-3 text-xs text-gray-400 font-medium">aether — direct message</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-white/70">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
          Live
        </span>
      </div>

      {/* Messages */}
      <div className="px-4 py-5 space-y-3 bg-black/30">
        <div className="flex items-end gap-2 max-w-[80%]">
          <div className="w-7 h-7 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold text-white">
            N
          </div>
          <div className="rounded-2xl rounded-bl-md bg-white/8 border border-white/10 px-3 py-2 text-sm text-gray-100">
            Yo — the aurora update is live 🚀
          </div>
        </div>
        <div className="flex items-end gap-2 ml-auto max-w-[80%]">
          <div className="rounded-2xl rounded-br-md bg-white text-black px-3 py-2 text-sm shadow-xl shadow-black/50">
            Statuses, E2E and instant sends. Clean.
          </div>
        </div>
        <div className="flex items-end gap-2 max-w-[80%]">
          <div className="w-7 h-7 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold text-white">
            N
          </div>
          <div>
            <div className="rounded-2xl rounded-bl-md bg-white/8 border border-white/10 px-3 py-2 text-sm text-gray-100">
              Sending a photo…
            </div>
            <div className="mt-1.5 flex gap-1 pl-1">
              <span className="h-10 w-10 rounded-lg bg-gradient-to-br from-white/70 to-white/20 ring-2 ring-white/20" />
              <span className="h-10 w-10 rounded-lg bg-gradient-to-br from-white/70 to-white/20 ring-2 ring-white/20" />
            </div>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-t border-white/10 bg-white/5">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-gray-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </span>
          <span className="flex-1 rounded-full bg-black/40 border border-white/10 px-4 py-2.5 text-xs text-gray-500">
            Message Nova…
          </span>
          <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black shadow-lg shadow-black/50">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen w-full flex flex-col text-white relative">
      <Background />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full flex flex-col min-h-screen">
        {/* Navbar — floating glass pill */}
        <nav className="sticky top-4 z-50 mt-4 flex justify-between items-center gap-4 glass rounded-2xl px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-black border border-white/30 flex items-center justify-center text-base font-serif italic font-bold text-white shadow-lg shadow-black/50">
              A
            </div>
            <span className="text-sm font-semibold tracking-tight">Aether</span>
          </div>

          <div className="hidden md:flex gap-7 text-sm font-medium">
            <Link href="/features" className="text-gray-400 hover:text-white transition-colors">
              Features
            </Link>
            <Link href="/docs" className="text-gray-400 hover:text-white transition-colors">
              Docs
            </Link>
          </div>

          <AuthNav />
        </nav>

        {/* Hero */}
        <section className="flex-1 flex flex-col justify-center items-center text-center py-16 md:py-20 gap-6 max-w-4xl mx-auto w-full">
          <div className="fade-up inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs font-medium text-gray-300">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-white" />
            The community chat for people who hate noise
          </div>

          <h1 className="fade-up fade-up-1 font-serif text-5xl md:text-7xl lg:text-8xl leading-[1.02] tracking-tight">
            The future of
            <br />
            <span className="text-gradient">community chat.</span>
          </h1>

          <p className="fade-up fade-up-2 text-lg text-gray-400 max-w-xl leading-relaxed font-light">
            Real-time messages, end-to-end encryption, and media that stays yours —
            without the feed, the ads, or the noise.
          </p>

          <div className="fade-up fade-up-3 flex flex-wrap gap-4 mt-2 justify-center">
            <Link
              href="/signup"
              className="btn-glow px-8 py-3.5 rounded-full bg-white text-black font-medium hover:brightness-110 active:scale-95 transition-all duration-300"
            >
              Get started — it&apos;s free
            </Link>
            <Link
              href="/docs"
              className="glass px-8 py-3.5 rounded-full text-gray-200 font-medium hover:bg-white/10 hover:border-white/25 transition-all duration-300"
            >
              Read the docs
            </Link>
          </div>

          {/* Product mock */}
          <div className="fade-up fade-up-4 w-full mt-6 float-soft">
            <ChatMock />
          </div>
        </section>

        {/* Feature cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-20">
          {[
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                </svg>
              ),
              title: "End-to-end encrypted",
              desc: "DMs are locked on your device before they ever reach a server.",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              ),
              title: "Instant by design",
              desc: "Live streaming, optimistic sends, parallel media uploads.",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              ),
              title: "Media that respects you",
              desc: "Auto-compressed, EXIF-oriented, encrypted at rest, archived to your drive.",
            },
            {
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              ),
              title: "Presence that feels human",
              desc: "Online, idle, away, busy, DND — without the status anxiety.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group glass rounded-2xl p-5 transition-all duration-300 hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/90 to-white/30 flex items-center justify-center text-black shadow-lg mb-4 transition-transform duration-300 group-hover:scale-110">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* Footer */}
        <footer className="border-t border-white/10 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-black border border-white/30 flex items-center justify-center text-xs font-serif italic font-bold text-white">
                A
              </div>
              <span className="text-sm text-gray-500">Aether — the future of community chat.</span>
            </div>
            <div className="flex gap-6 text-sm">
              <Link href="/terms" className="text-gray-400 hover:text-white transition-colors">
                Terms of Service
              </Link>
              <Link href="/privacy" className="text-gray-400 hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <Link href="/rules" className="text-gray-400 hover:text-white transition-colors">
                Rules
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
