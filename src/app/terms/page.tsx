import Link from "next/link";
import Background from "@/components/Background";

export default function Terms() {
  return (
    <div className="min-h-screen text-white font-sans relative">
      <Background />
      <nav className="sticky top-4 z-50 glass px-6 py-4 flex justify-between items-center max-w-7xl mx-auto mt-4 rounded-2xl">
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

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-20 space-y-12">
        <h1 className="font-serif text-5xl lg:text-6xl tracking-tight mb-8">Terms of Service</h1>
        
        <section className="space-y-4">
          <h2 className="text-2xl font-medium">1. Acceptance of Terms</h2>
          <p className="text-gray-400 leading-relaxed">
            By accessing and using Aether, you agree to be bound by these Terms of Service. If you do not agree, please do not use the platform.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">2. User Conduct</h2>
          <p className="text-gray-400 leading-relaxed">
            You agree to use Aether responsibly. Harassment, spam, illegal activity, or any behavior that disrupts the community is strictly prohibited.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">3. Intellectual Property</h2>
          <p className="text-gray-400 leading-relaxed">
            Aether and its content are protected by copyright and trademark laws. You may not copy, modify, or distribute any part of the platform without permission.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">4. Termination</h2>
          <p className="text-gray-400 leading-relaxed">
            We reserve the right to suspend or terminate your account at our discretion if you violate these terms.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-medium">5. Changes to Terms</h2>
          <p className="text-gray-400 leading-relaxed">
            These terms may be updated from time to time. Continued use of Aether constitutes acceptance of the revised terms.
          </p>
        </section>
      </main>
    </div>
  );
}