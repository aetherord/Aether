"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ImageViewerProps {
  srcs: string[]; // image URLs, in order
  index: number; // starting image
  onClose: () => void;
  onNavigate?: (index: number) => void;
}

/**
 * Aether custom image viewer — replaces the browser context. Wheel/buttons to
 * zoom, drag to pan when zoomed, arrow keys to step through the album,
 * Esc or backdrop-click to close, download button for the current image.
 */
export default function ImageViewer({ srcs, index, onClose, onNavigate }: ImageViewerProps) {
  const [current, setCurrent] = useState(index);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback(
    (delta: number) => {
      setCurrent((c) => {
        const next = (c + delta + srcs.length) % srcs.length;
        onNavigate?.(next);
        return next;
      });
      setZoom(1);
      setPos({ x: 0, y: 0 });
    },
    [srcs.length, onNavigate]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(1, z - 0.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) setZoom((z) => Math.min(4, z + 0.25));
    else setZoom((z) => Math.max(1, z - 0.25));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setDrag({ x: e.clientX, y: e.clientY, sx: pos.x, sy: pos.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setPos({ x: drag.sx + (e.clientX - drag.x), y: drag.sy + (e.clientY - drag.y) });
  };

  const onPointerUp = () => setDrag(null);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === containerRef.current) onClose();
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 select-none">
        <span className="text-xs text-gray-400 font-mono">
          {current + 1} / {srcs.length}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center text-lg"
            title="Zoom out"
          >
            −
          </button>
          <span className="w-10 text-center text-xs text-gray-400 font-mono">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center text-lg"
            title="Zoom in"
          >
            +
          </button>
          <a
            href={srcs[current]}
            download
            target="_blank"
            rel="noreferrer"
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center"
            title="Download"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </a>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-red-500/30 hover:text-red-300 transition flex items-center justify-center"
            title="Close (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image stage */}
      <div
        className="flex-1 overflow-hidden relative"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={srcs[current]}
          alt="Enlarged media"
          draggable={false}
          className="max-w-full max-h-full select-none transition-transform duration-150"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
            position: "absolute",
            inset: 0,
            margin: "auto",
            objectFit: "contain",
          }}
        />
      </div>

      {/* Nav arrows */}
      {srcs.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 transition flex items-center justify-center"
            title="Previous (←)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 transition flex items-center justify-center"
            title="Next (→)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
