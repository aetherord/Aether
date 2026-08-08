import type { ReactNode } from "react";

/**
 * Lightweight inline text formatter for chat messages.
 *
 *   ***bold italic***   **bold**   *italic*   _blue italic_
 *   ~~strikethrough~~   `inline code`
 *
 * Delimiters must be closed — an unclosed marker is left as literal text, so
 * writing "2 * 3 = 6" never mangles a message. A backslash escapes a marker
 * (e.g. \*literal\*). Output is plain React elements — no HTML injection.
 */

type Segment =
  | { t: "text"; s: string }
  | { t: "em"; children: Segment[] }
  | { t: "strong"; children: Segment[] }
  | { t: "strongEm"; children: Segment[] }
  | { t: "strike"; children: Segment[] }
  | { t: "blue"; children: Segment[] }
  | { t: "code"; s: string };

const DELIMS: { run: string; kind: Segment["t"] }[] = [
  { run: "***", kind: "strongEm" },
  { run: "**", kind: "strong" },
  { run: "~~", kind: "strike" },
  { run: "`", kind: "code" },
  { run: "*", kind: "em" },
  { run: "_", kind: "blue" },
];

/** Finds the closing delimiter for `run`, respecting backslash escapes. */
function findCloser(src: string, from: number, run: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src.startsWith(run, i)) return i;
    i += 1;
  }
  return -1;
}

function parseSegment(src: string, start = 0): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let i = start;

  const flush = () => {
    if (text) {
      out.push({ t: "text", s: text });
      text = "";
    }
  };

  while (i < src.length) {
    if (src[i] === "\\" && i + 1 < src.length) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    const hit = DELIMS.find((d) => src.startsWith(d.run, i));
    if (!hit) {
      text += src[i];
      i += 1;
      continue;
    }
    const close = findCloser(src, i + hit.run.length, hit.run);
    if (close === -1) {
      text += src[i];
      i += 1;
      continue;
    }
    const inner = src.slice(i + hit.run.length, close);
    // Skip empty (e.g. ** **) or whitespace-only content — keep the literal.
    if (!inner.trim()) {
      text += src[i];
      i += 1;
      continue;
    }
    flush();
    if (hit.kind === "code") {
      out.push({ t: "code", s: inner });
    } else {
      out.push({
        t: hit.kind as "em" | "strong" | "strongEm" | "strike" | "blue",
        children: parseSegment(inner),
      });
    }
    i = close + hit.run.length;
  }
  flush();
  return out;
}

function renderSegment(seg: Segment, key: number): ReactNode {
  switch (seg.t) {
    case "text":
      return <span key={key}>{seg.s}</span>;
    case "em":
      return (
        <em key={key} className="italic">
          {renderSegments(seg.children)}
        </em>
      );
    case "strong":
      return (
        <strong key={key} className="font-semibold">
          {renderSegments(seg.children)}
        </strong>
      );
    case "strongEm":
      return (
        <strong key={key} className="font-semibold italic">
          {renderSegments(seg.children)}
        </strong>
      );
    case "strike":
      return (
        <span key={key} className="line-through opacity-70">
          {renderSegments(seg.children)}
        </span>
      );
    case "blue":
      return (
        <em key={key} className="italic text-sky-500">
          {renderSegments(seg.children)}
        </em>
      );
    case "code":
      return (
        <code
          key={key}
          className="rounded bg-white/10 border border-white/10 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {seg.s}
        </code>
      );
  }
}

function renderSegments(segs: Segment[]): ReactNode[] {
  return segs.map((s, i) => renderSegment(s, i));
}

/** Formats chat text into styled React nodes. */
export function formatText(text: string): ReactNode[] {
  return renderSegments(parseSegment(text));
}

/** Strips the formatting markers (for plain-text previews like the DM list). */
export function plainText(text: string): string {
  return text
    .replace(/\\/g, "")
    .replace(/\*\*\*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/~~/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "");
}
