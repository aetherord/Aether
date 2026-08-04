import Link from "next/link";

export default function Docs() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      {/* Sticky Navbar */}
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
      <section className="max-w-5xl mx-auto px-6 pt-32 pb-12 text-center">
        <div className="inline-block px-4 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-medium text-gray-300 mb-6">
          User Guide
        </div>
        <h1 className="font-serif text-6xl lg:text-8xl leading-[1.05] tracking-tight mb-6">
          How to use <br /> Aether.
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed font-light">
          Everything you need to get started, from creating your first server to sharing files and chatting with your community.
        </p>
      </section>

      {/* Step-by-step user guide */}
      <section className="max-w-4xl mx-auto px-6 pb-32 space-y-16">
        {/* Step 1 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-start border-b border-white/5 pb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-sm font-bold text-white">1</span>
              <h2 className="text-2xl font-medium">Create an account</h2>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Click the &quot;Get started&quot; button in the top-right corner. Enter a username and password to create your account.
            </p>
          </div>
          <div className="md:col-span-3 bg-white/5 rounded-xl p-6 border border-white/10 flex items-center justify-center text-gray-500 h-32">
            [Image: Sign-up screen illustration]
          </div>
        </div>

        {/* Step 2 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-start border-b border-white/5 pb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-sm font-bold text-white">2</span>
              <h2 className="text-2xl font-medium">Join or create a server</h2>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Once logged in, you can create a new server (your own private space) or join an existing one using an invite link.
            </p>
          </div>
          <div className="md:col-span-3 bg-white/5 rounded-xl p-6 border border-white/10 flex items-center justify-center text-gray-500 h-32">
            [Image: Server creation screen]
          </div>
        </div>

        {/* Step 3 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-start border-b border-white/5 pb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-sm font-bold text-white">3</span>
              <h2 className="text-2xl font-medium">Start chatting</h2>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Click a channel in your server to start typing. Messages appear instantly. Use the file upload button to share images and videos.
            </p>
          </div>
          <div className="md:col-span-3 bg-white/5 rounded-xl p-6 border border-white/10 flex items-center justify-center text-gray-500 h-32">
            [Image: Chat interface]
          </div>
        </div>

        {/* Step 4 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-start pb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-sm font-bold text-white">4</span>
              <h2 className="text-2xl font-medium">Customize your profile</h2>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Click your profile picture to change your display name, avatar, and status. You can also manage server permissions from settings.
            </p>
          </div>
          <div className="md:col-span-3 bg-white/5 rounded-xl p-6 border border-white/10 flex items-center justify-center text-gray-500 h-32">
            [Image: User settings panel]
          </div>
        </div>
      </section>

      {/* Support CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-20 text-center border-t border-white/5 pt-16">
        <h2 className="text-3xl font-serif mb-4">Need more help?</h2>
        <p className="text-gray-400 mb-6">Join our community Discord or send us an email at support@aetherord.pages.dev</p>
        <Link href="#" className="px-6 py-3 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">Contact Support</Link>
      </section>
    </div>
  );
}
