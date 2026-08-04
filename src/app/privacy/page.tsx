import Link from "next/link";

export default function Privacy() {
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
        <h1 className="font-serif text-5xl lg:text-6xl tracking-tight mb-8">Privacy Policy</h1>
        
        <section className="space-y-4">
          <h2 className="text-2xl font-medium">1. Information We Collect</h2>
          <p className="text-gray-400 leading-relaxed">
            We collect minimal data: your email address and username when you create an account. We do not track your activity across the web.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">2. How We Use Your Data</h2>
          <p className="text-gray-400 leading-relaxed">
            Your data is used solely to provide the Aether service — sending messages, managing your account, and connecting you with others.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">3. Data Security</h2>
          <p className="text-gray-400 leading-relaxed">
            Your data is encrypted in transit and at rest. We do not sell or share your data with third parties.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">4. Your Rights</h2>
          <p className="text-gray-400 leading-relaxed">
            You may request deletion of your account and associated data at any time by contacting us.
          </p>
        </section>
      </main>
    </div>
  );
}