import Link from "next/link";

export default function Home() {
	return (
		<main
			className="min-h-screen w-full flex flex-col text-white relative"
			style={{
				backgroundImage: "url('/backgrounds/black-abstract.png')",
				backgroundSize: "cover",
				backgroundPosition: "center",
				backgroundRepeat: "no-repeat",
			}}
		>
			{/* Overlay for text readability */}
			<div className="absolute inset-0 bg-black/40 z-0" />

			<div className="relative z-10 max-w-7xl mx-auto px-6 w-full h-full flex flex-col">
				{/* Navbar */}
				<nav className="flex justify-between items-center py-6 border-b border-white/10">
					{/* Logo */}
					<div className="flex items-center gap-1 text-xl tracking-tight">
						<span className="font-serif text-3xl italic font-bold text-white/90">A</span>
						<span className="font-bold text-white">ether</span>
					</div>

					<div className="hidden md:flex gap-8 text-sm font-medium">
						<Link href="#" className="text-gray-400 hover:text-white transition-colors">
							Features
						</Link>
						<Link href="#" className="text-gray-400 hover:text-white transition-colors">
							Docs
						</Link>
					</div>

					<div className="flex items-center gap-4">
						<Link
							href="/login"
							className="text-sm text-gray-400 hover:text-white transition-colors"
						>
							Log in
						</Link>
						<Link
							href="/signup"
							className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium border border-transparent hover:bg-transparent hover:text-white hover:border-white/50 transition-all duration-300"
						>
							Get started
						</Link>
					</div>
				</nav>

				{/* Hero Section */}
				<section className="flex-1 flex flex-col justify-center items-center text-center py-20 gap-6 max-w-4xl mx-auto">
					<div className="inline-block px-4 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-medium text-gray-300">
						Join the <span className="text-white">Aether</span> network →
					</div>

					<h1 className="font-serif text-6xl lg:text-8xl leading-[1.05] tracking-tight">
						The future of <br /> community chat.
					</h1>

					<p className="text-lg text-gray-400 max-w-lg leading-relaxed font-light">
						The best way to connect your people, without the noise. Designed for clarity, built for scale.
					</p>

					<div className="flex flex-wrap gap-4 mt-4">
						<Link
							href="/signup"
							className="px-8 py-3 rounded-full bg-white text-black font-medium border border-transparent hover:bg-transparent hover:text-white hover:border-white/50 transition-all duration-300"
						>
							Get started
						</Link>
						<Link
							href="#"
							className="px-8 py-3 text-gray-300 hover:text-white transition-colors flex items-center gap-1"
						>
							Documentation &rarr;
						</Link>
					</div>
				</section>
			</div>
		</main>
	);
}