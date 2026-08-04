import Link from "next/link";

export default function Docs() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/10 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <Link href="/" className="text-3xl font-serif italic font-bold text-white/90 tracking-tight">A</Link>
        <div className="hidden md:flex gap-8 text-sm font-medium">
          <Link href="/features" className="text-gray-400 hover:text-white transition-colors">Features</Link>
          <Link href="/docs" className="text-white border-b-2 border-white/50 pb-1">Docs</Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white">Log in</Link>
          <Link href="/signup" className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-32 pb-16 text-center">
        <h1 className="font-serif text-6xl lg:text-8xl leading-[1.05] tracking-tight mb-6">
          How to use Aether.
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed font-light">
          No fluff. Just the steps.
        </p>
      </section>

      {/* Instructions */}
      <section className="max-w-4xl mx-auto px-6 pb-32 space-y-20">
        {/* 1 */}
        <div>
          <h2 className="text-2xl font-medium mb-3 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-white text-sm font-bold">1</span>
            Create an account
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Click &quot;Get started&quot; in the top right. Enter a username and password. That's it.
          </p>
        </div>

        {/* 2 */}
        <div>
          <h2 className="text-2xl font-medium mb-3 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-white text-sm font-bold">2</span>
            Join or create a server
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Once logged in, create a new server (your own space) or join one using an invite link from a friend.
          </p>
        </div>

        {/* 3 */}
        <div>
          <h2 className="text-2xl font-medium mb-3 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-white text-sm font-bold">3</span>
            Start chatting
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Click any channel to type. Messages appear instantly. Use the paperclip button to share images and videos.
          </p>
        </div>

        {/* 4 */}
        <div>
          <h2 className="text-2xl font-medium mb-3 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-white text-sm font-bold">4</span>
            Customize your profile
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Click your avatar to change your display name, profile picture, or status.
          </p>
        </div>
      </section>
    </div>
  );
}
