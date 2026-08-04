import Link from "next/link";

export default function Rules() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/10 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <Link href="/" className="text-3xl font-serif italic font-bold text-white/90 tracking-tight">A</Link>
        <div className="hidden md:flex gap-8 text-sm font-medium">
          <Link href="/features" className="text-gray-400 hover:text-white transition-colors">Features</Link>
          <Link href="/docs" className="text-gray-400 hover:text-white transition-colors">Docs</Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white">Log in</Link>
          <Link href="/signup" className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">Get started</Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-20 space-y-12">
        <h1 className="font-serif text-5xl lg:text-6xl tracking-tight mb-8">Community Rules</h1>
        
        <section className="space-y-4">
          <h2 className="text-2xl font-medium">1. Be Respectful</h2>
          <p className="text-gray-400 leading-relaxed">
            Treat everyone with kindness and respect. Harassment, hate speech, or bullying will not be tolerated.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">2. No Spam</h2>
          <p className="text-gray-400 leading-relaxed">
            Do not spam channels with repetitive messages, advertisements, or unrelated content.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">3. Protect Privacy</h2>
          <p className="text-gray-400 leading-relaxed">
            Do not share personal information of other users without their explicit consent.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">4. No Illegal Content</h2>
          <p className="text-gray-400 leading-relaxed">
            Content that violates local, national, or international law is strictly forbidden.
          </p>
        </section>
      </main>
    </div>
  );
}