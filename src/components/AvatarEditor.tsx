"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AvatarEditorProps {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onDone: (file: File) => void;
}

const PREVIEW = 280; // preview canvas css size
const OUTPUT = 512; // saved square avatar size

/**
 * Aether avatar editor — drag / zoom / rotate a photo to frame a square crop,
 * saved as a 512×512 WebP. Pure canvas, no libraries.
 */
export default function AvatarEditor({ file, busy, onCancel, onDone }: AvatarEditorProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // degrees
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setZoom(1);
      setRot(0);
      setDrag({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Renders the transformed image into any square canvas. */
  const draw = useCallback(
    (canvas: HTMLCanvasElement, size: number) => {
      if (!img) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(size / 2 + (drag.x * size) / PREVIEW, size / 2 + (drag.y * size) / PREVIEW);
      ctx.rotate((rot * Math.PI) / 180);
      const k = (size * zoom) / Math.max(img.naturalWidth, img.naturalHeight);
      ctx.scale(k, k);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    },
    [img, zoom, rot, drag]
  );

  useEffect(() => {
    const canvas = previewRef.current;
    if (canvas && img) draw(canvas, PREVIEW);
  }, [draw, img]);

  /** Keeps the image covering the crop window no matter the transform. */
  const clampDrag = useCallback(
    (x: number, y: number) => {
      if (!img) return { x, y };
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const w = (img.naturalWidth * PREVIEW * zoom) / maxDim;
      const h = (img.naturalHeight * PREVIEW * zoom) / maxDim;
      const rad = (rot * Math.PI) / 180;
      const hx = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
      const hy = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2;
      const limX = Math.max(0, hx - PREVIEW / 2);
      const limY = Math.max(0, hy - PREVIEW / 2);
      return {
        x: Math.min(Math.max(x, -limX), limX),
        y: Math.min(Math.max(y, -limY), limY),
      };
    },
    [img, zoom, rot]
  );

  // Re-clamp the drag whenever zoom/rotation changes so the image never
  // drifts out of the crop window (clamp normally runs on pointer drag only).
  useEffect(() => {
    setDrag((d) => clampDrag(d.x, d.y));
  }, [zoom, rot, clampDrag]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: drag.x, py: drag.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(clampDrag(d.px + (e.clientX - d.sx), d.py + (e.clientY - d.sy)));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const rotate = (deg: number) => setRot((r) => ((r + deg) % 360 + 360) % 360);
  const reset = () => {
    setZoom(1);
    setRot(0);
    setDrag({ x: 0, y: 0 });
  };

  const save = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    draw(canvas, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (blob) onDone(new File([blob], "avatar.webp", { type: "image/webp" }));
      },
      "image/webp",
      0.9
    );
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#121215] shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Crop your photo</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors p-1" title="Cancel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mx-auto w-[280px] h-[280px] rounded-2xl overflow-hidden border border-white/10 bg-black relative select-none">
          <canvas
            ref={previewRef}
            width={PREVIEW}
            height={PREVIEW}
            className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {/* Crop guide — subtle vignette corners */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/15 ring-inset" />
        </div>

        <p className="text-center text-[11px] text-gray-500 mt-2">Drag to position · zoom &amp; rotate to frame</p>

        {/* Controls */}
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => rotate(-90)} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center" title="Rotate left">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <button onClick={() => rotate(90)} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center" title="Rotate right">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
            <button onClick={reset} className="px-3 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs" title="Reset">
              Reset
            </button>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 shrink-0">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-white"
                title="Zoom"
              />
              <span className="text-[11px] text-gray-500 font-mono w-8 text-right shrink-0">{zoom.toFixed(2)}×</span>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onCancel}
              disabled={busy}
              className="flex-1 py-2.5 rounded-full border border-white/15 text-sm text-gray-300 hover:text-white hover:border-white/40 transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !img}
              className="flex-1 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save avatar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
