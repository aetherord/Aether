/** Monochrome site background: drifting white aurora blobs over a faint
 *  grid, finished with film grain. Rendered fixed so it sits behind every
 *  page's glass UI. */
export default function Background() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-[#050506]">
      <div className="absolute inset-0 bg-grid" />
      <div className="aurora-blob w-[640px] h-[640px] bg-white/20 -top-44 -left-36" />
      <div
        className="aurora-blob w-[560px] h-[560px] bg-white/15 top-1/3 -right-44"
        style={{ animationDelay: "-7s" }}
      />
      <div
        className="aurora-blob w-[520px] h-[520px] bg-white/12 bottom-[-180px] left-1/4"
        style={{ animationDelay: "-14s" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#050506_78%)]" />
      <div className="absolute inset-0 bg-noise" />
    </div>
  );
}
