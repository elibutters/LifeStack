// Pure rules for a session's plan note. A coach writes it as short sections with one movement or step per bullet:
//
//   Warm-up:
//   - 5 min easy jog
//   Main set:
//   - Bench press: 4 x 5-6 at effort 7 out of 10, rest 2-3 minutes
//   Cool-down:
//   - 5 min walk
//   Notes:
//   - Only if the toe is pain-free; otherwise skip.
//
// Everything under a "Notes:" heading (or cues, cautions, reminders) is kept apart from the plan so the plan stays short; the screens show it
// collapsed.
//
// Older notes were written as one comma-separated line; a line with three or more items is split into bullets so those read the same way.
export type NoteBlock = { kind: "heading" | "bullet" | "text"; text: string };

// Older notes used shorthand nobody says out loud. Shown in plain words, whatever was stored.
const SPELLINGS: [RegExp, string][] = [
  [/\bWU\b/g, "warm-up"],
  [/\bCD\b/g, "cool-down"],
  [/\bw\/o\b/gi, "without"],
  [/\bw\//gi, "with"],
  [/\bRPE\s*(\d+(?:\.\d+)?)/gi, "effort $1 out of 10"],
  [/\bRIR\s*(\d+)/gi, "$1 reps in reserve"],
  [/\bOHP\b/g, "overhead press"],
  [/\bRDL(s?)\b/g, "Romanian deadlift$1"],
  [/\bDB(s?)\b/g, "dumbbell$1"],
  [/\bBB\b/g, "barbell"],
  [/\bKB(s?)\b/g, "kettlebell$1"],
  [/\bBW\b/g, "bodyweight"],
  [/\bSL\b/g, "single-leg"],
  [/\bAMRAP\b/g, "as many reps as possible"],
  [/\bEMOM\b/g, "every minute on the minute"],
  [/\bHR\b/g, "heart rate"],
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

export type SplitNote = { plan: NoteBlock[]; notes: NoteBlock[] };

const NOTES_HEADING = /^(?:notes?|coach(?:'s|es)? notes?|cues?|cautions?|reminders?|why|heads[- ]up|safety|modifications?|adjustments?)$/i;
// In an older one-line note, a sentence that starts like this is a caution or condition, not part of the workout.
const CAVEAT = /^(?:only if|if |otherwise|skip |unless|toe |watch |stop |listen )/i;

export function splitSessionNote(note: string | null | undefined): SplitNote {
  const text = (note ?? "").replace(/\r\n?/g, "\n").trim();
  const plan: NoteBlock[] = [], notes: NoteBlock[] = [];
  if (!text) return { plan, notes };
  const spell = (bs: NoteBlock[]) => bs.map((b) => ({ ...b, text: spellOut(b.text) }));
  if (!text.includes("\n")) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const side = sentences.filter((x) => CAVEAT.test(x));
    const main = sentences.filter((x) => !CAVEAT.test(x));
    if (main.length === 0 || side.length === 0) return { plan: spell(rawBlocks(text)), notes };
    return { plan: spell(rawBlocks(main.join(" "))), notes: spell(side.map((x) => ({ kind: "text" as const, text: x }))) };
  }
  let inNotes = false;
  for (const b of rawBlocks(text)) {
    if (b.kind === "heading") {
      inNotes = NOTES_HEADING.test(b.text);
      if (inNotes) continue; // the section itself is labelled "Notes" on screen
    }
    (inNotes ? notes : plan).push(b);
  }
  return { plan: spell(plan), notes: spell(notes) };
}

export const parseSessionNote = (note: string | null | undefined): NoteBlock[] => splitSessionNote(note).plan;

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
  'Write the note like a coach, as short sections and one bullet per movement or step, each on its own line: a heading line ending in a colon ("Warm-up:", "Main set:", "Cool-down:", "Targets:"), then "- " bullets under it. Strength: "- Back squat: 4 sets of 5 at effort 7 out of 10, rest 2 to 3 minutes". Running: "- 3 repetitions of 1 mile at 7:10 to 7:20 per mile, 2 minutes of easy jogging between". Put the load, repetitions or pace, and rest on the bullet. Put reasons, cautions and conditions ("only if...", cues, what to watch for) under a final "Notes:" heading so the plan above stays short; the screens show those notes collapsed. No run-on comma lists. Use plain words everywhere, in the title too, never gym shorthand or abbreviations: write warm-up and cool-down (not WU or CD), overhead press (not OHP), Romanian deadlift (not RDL), dumbbell (not DB), single-leg (not SL), "with" (not w/), "effort 7 out of 10" (not RPE 7), heart rate (not HR). If you are about to type letters that only a gym regular would know, write the full words instead. Up to 2,000 characters.';
