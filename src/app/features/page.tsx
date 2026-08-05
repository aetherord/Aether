import Link from "next/link";

export default function Features() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/10 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <Link href="/" className="text-3xl font-serif italic font-bold text-white/90 tracking-tight">A</Link>
        <div className="hidden md:flex gap-8 text-sm font-medium absolute left-1/2 transform -translate-x-1/2">
          <Link href="/features" className="text-white border-b-2 border-white/50 pb-1">Features</Link>
          <Link href="/docs" className="text-gray-400 hover:text-white transition-colors">Docs</Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-gray-400 hover:text-white">Log in</Link>
          <Link href="/signup" className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium hover:bg-gray-200 transition">Get started</Link>
        </div>
      </nav>

      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6 text-center">
        <div className="inline-block px-4 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-medium text-gray-300 mb-6">
          Everything you need
        </div>
        <h1 className="font-serif text-6xl lg:text-8xl leading-[1.05] tracking-tight mb-6">
          Built for real <br /> connection.
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed font-light">
          Aether isn't just a chat app. It's a private, secure space designed for clarity and speed.
        </p>

        <div className="mt-16 space-y-12 text-left max-w-3xl w-full">
          <div className="border-b border-white/5 pb-12">
            <h2 className="text-3xl font-serif mb-4">Real-time messaging.</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Messages arrive instantly, no matter where you are. Powered by Cloudflare's global network, Aether keeps you in sync with zero lag.
            </p>
            <ul className="mt-4 space-y-1 text-gray-300">
              <li className="flex items-center gap-2">✓ Live typing indicators</li>
              <li className="flex items-center gap-2">✓ Read receipts</li>
              <li className="flex items-center gap-2">✓ Unlimited message history</li>
            </ul>
          </div>
          <div className="border-b border-white/5 pb-12">
            <h2 className="text-3xl font-serif mb-4">File sharing, your way.</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Drag and drop images, videos, or documents directly into any channel. Aether stores your media securely, giving you full control over access.
            </p>
            <ul className="mt-4 space-y-1 text-gray-300">
              <li className="flex items-center gap-2">✓ Inline previews for images and videos</li>
              <li className="flex items-center gap-2">✓ Organized file archives</li>
              <li className="flex items-center gap-2">✓ Access-controlled storage</li>
            </ul>
          </div>
          <div className="border-b border-white/5 pb-12">
            <h2 className="text-3xl font-serif mb-4">Servers and channels.</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Create a server for your community, then organize conversations into channels. Public or private, text or voice — you decide.
            </p>
            <ul className="mt-4 space-y-1 text-gray-300">
              <li className="flex items-center gap-2">✓ Unlimited servers and channels</li>
              <li className="flex items-center gap-2">✓ Role-based permissions</li>
              <li className="flex items-center gap-2">✓ Invite links for easy access</li>
            </ul>
          </div>
          <div className="border-b border-white/5 pb-12">
            <h2 className="text-3xl font-serif mb-4">Privacy first.</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              No tracking, no telemetry, no third-party data brokers. Aether is built with end-to-end encryption and zero data leakage.
            </p>
            <ul className="mt-4 space-y-1 text-gray-300">
              <li className="flex items-center gap-2">✓ End-to-end encrypted DMs</li>
              <li className="flex items-center gap-2">✓ Secure cloud infrastructure</li>
              <li className="flex items-center gap-2">✓ Zero telemetry</li>
            </ul>
          </div>
          <div>
            <h2 className="text-3xl font-serif mb-4">Cross-platform.</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Aether works on any device with a browser. Mobile, desktop, tablet — you're always connected.
            </p>
            <ul className="mt-4 space-y-1 text-gray-300">
              <li className="flex items-center gap-2">✓ Responsive web design</li>
              <li className="flex items-center gap-2">✓ Desktop and mobile ready</li>
              <li className="flex items-center gap-2">✓ Native-like experience</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}