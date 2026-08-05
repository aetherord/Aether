"use client";

import { useEffect, useState } from "react";
import { safeJson } from "@/lib/safeJson";

type Tab = "smileys" | "gestures" | "hearts" | "symbols" | "gifs";

const EMOJI_GROUPS: Record<Exclude<Tab, "gifs">, { label: string; icon: string; emojis: string[] }> = {
  smileys: {
    label: "Smileys",
    icon: "😀",
    emojis: [
      "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🫣","🤭","🫡","🤫","🫠","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾",
    ],
  },
  gestures: {
    label: "Gestures",
    icon: "👍",
    emojis: [
      "👍","👎","👌","🤌","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","👏","🙌","🫶","👐","🤲","🙏","💪","🦾","🖕","✍️","💅","🤳","💃","🕺","🫃","🫄","🚶","🏃","🧍","🧎","🛌","🛀","🛁","🧖","🧗","🤸","🤹","🧘","🏋️","🤼","🤾","🤽","🏊","🚣","🧗","👀","🧠","🫀","🫁","👃","👂","👄","🦷","👅","👁️","🗣️",
    ],
  },
  hearts: {
    label: "Hearts",
    icon: "❤️",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","💕","💞","💓","💗","💖","💘","💝","💟","❣️","💌","💋","💐","🌹","🥀","🌷","🌸","💮","🏵️","🎀","🎁","💍","🪬","✨","🌟","⭐","🌈","☀️","🌙","🔥","⚡","💫","🌊","🍀","🦋","🌻",
    ],
  },
  symbols: {
    label: "Symbols",
    icon: "🎉",
    emojis: [
      "🎉","🎊","🎈","🎂","🍰","🍕","🍔","🍟","🌮","🍣","🍜","🍩","🍪","☕","🍺","🍻","🥂","🍾","🎮","🎧","🎤","🎸","🎹","🎯","🎲","♟️","🏆","🥇","🥈","🥉","⚽","🏀","🏈","⚾","🎾","🏐","🏉","🥏","🎳","🏓","🏸","⛳","🚀","✈️","🚗","🚕","🚁","⏰","📱","💻","🖥️","📷","🎥","🔒","🔑","🗝️","📎","📌","📍","📝","📖","🔔","💡","🔦","🕯️","🧯","🪫","🔋","💰","💎","🧿","🕹️","🎭","🎪","🛹","🚲","🛴","🏍️","🎢","🎡","🎠",
    ],
  },
};

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onPickGif?: (url: string) => void;
}

/** Discord-style picker: category tabs at the bottom, GIFs tab proxied via /api/gifs. */
export default function EmojiPicker({ onPick, onPickGif }: EmojiPickerProps) {
  const [tab, setTab] = useState<Tab>("smileys");
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<{ url: string; preview: string; title: string }[]>([]);
  const [gifsConfigured, setGifsConfigured] = useState<boolean | null>(null);
  const [gifLoading, setGifLoading] = useState(false);

  useEffect(() => {
    if (tab !== "gifs") return;
    let alive = true;
    const q = gifQuery.trim();
    const timer = setTimeout(async () => {
      if (!q) {
        const res = await fetch("/api/gifs?q=funny");
        if (!alive) return;
        const data = await safeJson<{ configured?: boolean; results?: { url: string; preview: string; title: string }[] }>(res);
        if (alive) {
          setGifsConfigured(data.configured ?? false);
          setGifs(data.results ?? []);
        }
        return;
      }
      setGifLoading(true);
      try {
        const res = await fetch(`/api/gifs?q=${encodeURIComponent(q)}`);
        const data = await safeJson<{ configured?: boolean; results?: { url: string; preview: string; title: string }[] }>(res);
        if (alive) {
          setGifsConfigured(data.configured ?? false);
          setGifs(data.results ?? []);
        }
      } finally {
        if (alive) setGifLoading(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tab, gifQuery]);

  return (
    <div className="w-80 max-w-[80vw] h-80 flex flex-col rounded-2xl glass-strong overflow-hidden animate-in zoom-in-95 fade-in duration-150">
      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "gifs" ? (
          <div className="space-y-2">
            <input
              value={gifQuery}
              onChange={(e) => setGifQuery(e.target.value)}
              placeholder="Search GIFs…"
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30"
            />
            {gifsConfigured === false && (
              <p className="text-xs text-gray-500 px-1 py-4 text-center">
                GIFs need a Tenor API key (set <code className="text-gray-400">TENOR_API_KEY</code> in .env.local).
              </p>
            )}
            {gifLoading && (
              <div className="h-8 flex items-center justify-center">
                <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {gifs.map((g, i) => (
                <button
                  key={i}
                  onClick={() => onPickGif?.(g.url)}
                  title={g.title}
                  className="rounded-lg overflow-hidden bg-white/5 hover:ring-2 hover:ring-white/40 transition aspect-square"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.preview} alt={g.title} loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
            {gifs.length === 0 && gifsConfigured && !gifLoading && (
              <p className="text-xs text-gray-500 text-center py-6">No GIFs found.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_GROUPS[tab].emojis.map((e) => (
              <button
                key={e}
                onClick={() => onPick(e)}
                className="h-9 rounded-lg hover:bg-white/10 transition text-xl flex items-center justify-center"
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-t border-white/10 flex items-stretch justify-between px-1 py-1 bg-black/20">
        {(Object.keys(EMOJI_GROUPS) as Exclude<Tab, "gifs">[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-10 rounded-lg text-xl transition ${
              tab === t ? "bg-white/10" : "hover:bg-white/5"
            }`}
            title={EMOJI_GROUPS[t].label}
          >
            {EMOJI_GROUPS[t].icon}
          </button>
        ))}
        <button
          onClick={() => setTab("gifs")}
          className={`flex-1 h-10 rounded-lg text-[11px] font-bold uppercase tracking-wide transition ${
            tab === "gifs" ? "bg-white/10 text-white" : "hover:bg-white/5 text-gray-400"
          }`}
          title="GIFs"
        >
          GIF
        </button>
      </div>
    </div>
  );
}
