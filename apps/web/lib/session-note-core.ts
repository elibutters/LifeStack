// Pure rules for a session's plan note. A coach writes it as short sections with one movement or step per bullet:
//
//   Warm-up:
//   - 5 min easy jog
//   Main set:
//   - Bench press: 4 x 5-6 @ RPE 7, rest 2-3 min
//   Cool-down:
//   - 5 min walk
//
// Older notes were written as one comma-separated line; a line with three or more items is split into bullets so those read the same way.
export type NoteBlock = { kind: "heading" | "bullet" | "text"; text: string };

// Older notes used shorthand nobody says out loud. Shown in plain words, whatever was stored.
const SPELLINGS: [RegExp, string][] = [
  [/\bWU\b/g, "warm-up"],
  [/\bCD\b/g, "cool-down"],
  [/\bw\//gi, "with"],
  [/\bRPE\s*(\d+(?:\.\d+)?)/gi, "effort $1 out of 10"],
  [/\bDBs?\b/g, "dumbbell"],
];
export const spellOut = (text: string) => SPELLINGS.reduce((t, [re, to]) => t.replace(re, to), text);

// Splits on commas and semicolons that are not inside brackets, so "squat (belt, pause) 3x5" stays whole.
function topLevelParts(line: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of line) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/\.$/, "")).filter(Boolean);
}

const BULLET = /^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/;
const HEADING = /^(?:#{1,3}\s+(.+?):?|([^:]{1,40}):)$/;

export function parseSessionNote(note: string | null | undefined): NoteBlock[] {
  return rawBlocks(note).map((b) => ({ ...b, text: spellOut(b.text) }));
}

function rawBlocks(note: string | null | undefined): NoteBlock[] {
  const text = (note ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  if (!text.includes("\n")) {
    const parts = topLevelParts(text);
    if (parts.length >= 3) return parts.map((p) => ({ kind: "bullet" as const, text: p }));
    return [{ kind: "text", text }];
  }
  const out: NoteBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const b = BULLET.exec(line);
    if (b) { out.push({ kind: "bullet", text: b[1]!.trim() }); continue; }
    const h = HEADING.exec(line);
    if (h) { out.push({ kind: "heading", text: (h[1] ?? h[2])!.trim() }); continue; }
    out.push({ kind: "text", text: line });
  }
  return out;
}

// The same note as plain text for a calendar event body: headings end in a colon after a blank line, each bullet starts with "- ".
export function noteToText(blocks: NoteBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") lines.push(...(lines.length ? [""] : []), `${b.text}:`);
    else lines.push(b.kind === "bullet" ? `- ${b.text}` : b.text);
  }
  return lines.join("\n");
}

// What a coach would want an agent to write, shown in the tool descriptions.
export const NOTE_FORMAT =
  'Write the note like a coach, as short sections and one bullet per movement or step, each on its own line: a heading line ending in a colon ("Warm-up:", "Main set:", "Cool-down:", "Targets:", "Cues:"), then "- " bullets under it. Strength: "- Back squat: 4 x 5 @ RPE 7, rest 2-3 min". Running: "- 3 x 1 mi @ 7:10-7:20, 2:00 jog between". Put the load, reps or pace, and rest on the bullet, and keep cues and why to a final section. No run-on comma lists. Use plain words, never shorthand: write warm-up and cool-down (not WU or CD), "with" (not w/), and "effort 7 out of 10" (not RPE 7). Up to 2,000 characters.';
