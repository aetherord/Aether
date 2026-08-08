"use client";

import { useEffect, useState } from "react";
import VideoPlayer from "@/components/VideoPlayer";

type MediaStatus = "loading" | "ok" | "flagged" | "gone" | "error";

/**
 * Module-level cache: every bubble for the same media ref reuses the result,
 * so a room full of images doesn't refetch them on each re-render.
 */
const cache = new Map<string, { status: MediaStatus; url: string | null }>();

interface MediaBubbleProps {
  mediaRef: string;
  mime: string | null;
  className?: string;
  /** Fired when the media is quarantined (403) — parent tracks flagged refs. */
  onFlagged?: (ref: string) => void;
  /** Fired with the working URL when an ok image is clicked (lightbox). */
  onOpen?: (url: string, ref: string) => void;
  onError?: (ref: string) => void;
}

/**
 * Renders chat media with proper status awareness. Quarantined media (403 —
 * auto-flagged NSFW or reported) shows a "flagged for review" placeholder
 * instead of a broken image; missing media (404 — archived or deleted) shows
 * an "unavailable" placeholder. Fetches once per ref and caches the result.
 */
export default function MediaBubble({
  mediaRef,
  mime,
  className = "",
  onFlagged,
  onOpen,
  onError,
}: MediaBubbleProps) {
  const [state, setState] = useState<MediaStatus>(() => cache.get(mediaRef)?.status ?? "loading");
  const [url, setUrl] = useState<string | null>(() => cache.get(mediaRef)?.url ?? null);

  useEffect(() => {
    let alive = true;
    const hit = cache.get(mediaRef);
    if (hit) {
      setState(hit.status);
      setUrl(hit.url);
      if (hit.status === "flagged") onFlagged?.(mediaRef);
      return;
    }

    setState("loading");
    fetch(`/api/media/${encodeURIComponent(mediaRef)}`)
      .then(async (r) => {
        if (r.status === 403) {
          // Quarantined — withheld from non-admins.
          cache.set(mediaRef, { status: "flagged", url: null });
          if (alive) {
            setState("flagged");
            onFlagged?.(mediaRef);
          }
          return;
        }
        if (!r.ok) {
          // 404 — archived to the local drive or purged by an admin.
          cache.set(mediaRef, { status: "gone", url: null });
          if (alive) setState("gone");
          return;
        }
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        cache.set(mediaRef, { status: "ok", url: objectUrl });
        if (alive) {
          setUrl(objectUrl);
          setState("ok");
        }
      })
      .catch(() => {
        cache.set(mediaRef, { status: "error", url: null });
        if (alive) setState("error");
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaRef]);

  if (state === "loading") {
    return (
      <div
        className={`${className} flex items-center justify-center rounded-xl border border-white/10 bg-black/30 animate-pulse`}
        style={{ height: 160 }}
      />
    );
  }

  if (state === "flagged") {
    return (
      <div className={`${className} flex items-center gap-2 rounded-lg border border-dashed border-red-400/40 bg-red-950/25 px-3 py-2.5 text-xs text-red-200/90`}>
        <span aria-hidden>⚠</span>
        <span>Flagged for review — hidden pending moderation.</span>
      </div>
    );
  }

  if (state === "gone" || state === "error") {
    return (
      <div className={`${className} flex items-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 text-xs text-gray-400`}>
        <span aria-hidden>📦</span>
        <span>Media no longer available.</span>
      </div>
    );
  }

  const isVideo = (mime ?? "").startsWith("video/");
  if (isVideo) {
    return (
      <VideoPlayer
        src={url ?? ""}
        className={`${className} -mx-1 my-1 max-w-[26rem]`}
        onError={() => onError?.(mediaRef)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? undefined}
      alt="Shared media"
      loading="lazy"
      onClick={() => url && onOpen?.(url, mediaRef)}
      className={`${className} max-w-full max-h-80 rounded-xl -mx-1 my-1 object-contain cursor-zoom-in`}
    />
  );
}
