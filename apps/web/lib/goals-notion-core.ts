// Pure builders for a goal's Notion notebook: the page that is created for a goal and the lines added to it as the goal moves. No
// network and no database. Notion limits one piece of rich text to 2,000 characters, so long text is split into pieces.
export type Block = Record<string, unknown>;

const chunks = (text: string, size = 1900): string[] => {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
  return out;
};

const rich = (text: string) => chunks(text).map((c) => ({ type: "text", text: { content: c } }));
const heading = (text: string): Block => ({ object: "block", type: "heading_2", heading_2: { rich_text: rich(text) } });
const paragraph = (text: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: rich(text) } });
const bullet = (text: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(text) } });

export type NotebookGoal = { title: string; thesis: string; kind: string; targetDay: string | null; mode: string };

// The notebook starts with the thesis and a place to think; everything after the Log heading is added in order, so new lines land at the end.
export function notebookBlocks(g: NotebookGoal): Block[] {
  return [
    heading("Thesis"),
    paragraph(g.thesis || "Why this matters and what done looks like. (Add it here.)"),
    paragraph(`${g.kind}${g.targetDay ? ` · by ${g.targetDay}` : ""} · when a session slips: ${g.mode}`),
    heading("Brainstorm"),
    paragraph("Ideas, constraints and open questions."),
    heading("Log"),
  ];
}

export const logBlocks = (when: string, text: string): Block[] => [bullet(`${when}: ${text}`)];

// A plan that was committed, as a short heading line and a bullet per session (capped so a long plan stays readable).
export function planBlocks(when: string, lines: string[], total = lines.length): Block[] {
  const shown = lines.slice(0, 12);
  return [bullet(`${when}: plan committed, ${total} session${total === 1 ? "" : "s"}`), ...shown.map((l) => bullet(`    ${l}`)), ...(lines.length > shown.length ? [bullet(`    and ${lines.length - shown.length} more`)] : [])];
}

export const notebookUrl = (pageId: string) => `https://www.notion.so/${pageId.replace(/-/g, "")}`;
export const pageTitleOf = (title: string) => title.trim().slice(0, 200) || "Untitled goal";
