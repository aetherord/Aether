import Link from "next/link";

export default function Home() {
	return (
		<main className="min-h-screen bg-[#0a0a0a] text-white relative overflow-hidden">
			{/* Radial glow */}
			<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-white/5 to-transparent pointer-events-none" />

			<div className="max-w-7xl mx-auto px-6 relative z-10">
				{/* Navbar */}
				<nav className="flex justify-between items-center py-6 border-b border-white/5">
					<div className="text-xl font-bold tracking-tight">Aether</div>
					<div className="hidden md:flex gap-8 text-sm text-gray-400">
						<Link href="#" className="hover:text-white transition">Features</Link>
						<Link href="#" className="hover:text-white transition">Pricing</Link>
						<Link href="#" className="hover:text-white transition">Docs</Link>
					</div>
					<div className="flex items-center gap-4">
						<Link href="/login" className="text-sm text-gray-400 hover:text-white transition">
							Log in
						</Link>
						<Link
							href="/signup"
							className="px-4 py-2 text-sm rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition"
						>
							Get started
						</Link>
					</div>
				</nav>

				{/* Hero */}
				<section className="flex flex-col lg:flex-row items-center gap-12 py-24 lg:py-32">
					<div className="flex-1 max-w-xl">
						<div className="inline-block px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-gray-300 mb-8">
							Join the <span className="text-white">Aether</span> network →
						</div>
						<h1 className="font-serif text-5xl lg:text-7xl leading-[1.05] tracking-tight bg-gradient-to-br from-white via-white to-gray-500 bg-clip-text text-transparent">
							The future of community chat.
						</h1>
						<p className="mt-6 text-lg text-gray-400 max-w-md leading-relaxed">
							The best way to connect your people, without the noise. Designed for clarity, built for scale.
						</p>
						<div className="mt-8 flex flex-wrap gap-4">
							<Link
								href="/signup"
								className="px-6 py-3 rounded-full bg-[#1a1a1a] border border-white/10 hover:bg-[#2a2a2a] hover:border-white/20 transition"
							>
								Get started
							</Link>
							<Link
								href="#"
								className="px-6 py-3 text-gray-400 hover:text-white transition flex items-center gap-1"
							>
								Documentation &rarr;
							</Link>
						</div>
					</div>

					{/* CSS 3D Object */}
					<div className="flex-1 flex justify-center lg:justify-end">
						<div className="w-72 h-72 lg:w-96 lg:h-96 bg-gradient-to-br from-[#2a2a2a] to-[#0a0a0a] rounded-[3rem] shadow-[0_0_60px_rgba(255,255,255,0.03),inset_0_0_60px_rgba(255,255,255,0.02)] rotate-x-12 relative" />
					</div>
				</section>
			</div>
		</main>
	);
}