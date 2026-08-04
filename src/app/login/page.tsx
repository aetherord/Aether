import Link from "next/link";

export default function Login() {
  return (
    <div 
      className="min-h-screen w-full flex items-center justify-center text-white relative"
      style={{
        backgroundImage: "url('/backgrounds/black-abstract.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-black/40 z-0" />

      <div className="relative z-10 w-full max-w-md px-6">
        <Link href="/" className="mb-6 inline-block text-sm text-gray-400 hover:text-white transition-colors">
          Back to Aether
        </Link>

        <div className="bg-white/5 border border-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl animate-in fade-in duration-700 ease-out">
          <div className="text-center mb-8">
            <div className="text-3xl font-serif italic font-bold text-white/90 mb-2">A</div>
            <h1 className="text-2xl font-medium">Welcome back</h1>
            <p className="text-sm text-gray-400 mt-1">Log in to your Aether account.</p>
          </div>

          <form className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Username or Email</label>
              <input 
                type="text" 
                placeholder="Enter your username or email" 
                className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input 
                type="password" 
                placeholder="Enter your password" 
                className="w-full px-4 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition"
              />
            </div>

            <button 
              type="button"
              className="w-full py-3 mt-2 rounded-full bg-white text-black font-medium hover:bg-gray-200 transition-all duration-300"
            >
              Log in
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            Don't have an account?{' '}
            <Link href="/signup" className="text-white hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}