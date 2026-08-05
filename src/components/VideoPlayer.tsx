"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  src: string;
  className?: string;
  onError?: () => void;
}

/**
 * Custom Aether video player: dark, minimal, keyboard-friendly.
 * Controls auto-hide while playing. Supports click-to-seek on the scrubber,
 * drag-to-scrub, volume + mute, and fullscreen.
 */
export default function VideoPlayer({ src, className = "", onError }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fmt = (t: number) => {
    if (!Number.isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    poke();
  }, [poke]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    poke();
  }, [poke]);

  const seek = useCallback(
    (clientX: number) => {
      const v = videoRef.current;
      const el = scrubRef.current;
      if (!v || !el || !duration) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      v.currentTime = ratio * duration;
      setCurrent(v.currentTime);
    },
    [duration, poke]
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const scrubber = (duration > 0 ? (current / duration) * 100 : 0).toFixed(2);
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl bg-black group ${fullscreen ? "fixed inset-0 z-[60] rounded-none h-dvh w-dvh" : ""} ${className}`}
      onMouseMove={poke}
      onMouseLeave={() => {
        if (fullscreen) return;
        setControlsVisible(false);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          poke();
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onProgress={() => {
          const v = videoRef.current;
          if (v && v.buffered.length > 0) {
            setBuffered(v.buffered.end(v.buffered.length - 1));
          }
        }}
        onError={onError}
        className={`max-w-full w-full object-contain cursor-pointer ${fullscreen ? "h-full" : "max-h-80"}`}
      />

      {/* Center play button */}
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className={`absolute inset-0 m-auto h-16 w-16 rounded-full bg-black/60 border border-white/20 backdrop-blur-sm flex items-center justify-center transition-all duration-200 ${
          playing ? "opacity-0 scale-90 pointer-events-none" : "opacity-100 hover:scale-105 hover:bg-black/70"
        }`}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
          <path d={playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M8 5v14l11-7z"} />
        </svg>
      </button>

      {/* Controls bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pt-8 pb-2.5 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Scrubber */}
        <div
          ref={scrubRef}
          className="group/scrub relative h-4 flex items-center cursor-pointer"
          onClick={(e) => seek(e.clientX)}
          onMouseMove={(e) => {
            if (e.buttons === 1) seek(e.clientX);
          }}
        >
          <div className="w-full h-1 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-white/25" style={{ width: `${bufferedPct}%` }} />
          </div>
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white group-hover/scrub:h-1.5 transition-all"
            style={{ width: `${scrubber}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow scale-0 group-hover/scrub:scale-100 transition-transform"
            style={{ left: `calc(${scrubber}% - 7px)` }}
          />
        </div>

        {/* Buttons */}
        <div className="mt-1 flex items-center gap-3">
          <button onClick={togglePlay} className="text-white hover:text-gray-300 transition" aria-label={playing ? "Pause" : "Play"}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d={playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M8 5v14l11-7z"} />
            </svg>
          </button>

          <button onClick={toggleMute} className="text-white hover:text-gray-300 transition" aria-label={muted ? "Unmute" : "Mute"}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              {muted ? (
                <path d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
              ) : volume === 0 ? (
                <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
              ) : volume < 0.5 ? (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              ) : (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              )}
            </svg>
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = videoRef.current;
              if (!v) return;
              v.volume = Number(e.target.value);
              v.muted = Number(e.target.value) === 0;
              setVolume(v.volume);
              setMuted(v.muted);
            }}
            className="w-20 accent-white h-1 cursor-pointer"
          />

          <span className="text-[11px] text-white/80 font-mono tabular-nums ml-1">
            {fmt(current)} / {fmt(duration)}
          </span>

          <button
            onClick={toggleFullscreen}
            className="ml-auto text-white hover:text-gray-300 transition"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {fullscreen ? (
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              ) : (
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
