/** Tiny XSS-safe Markdown renderer for assistant replies.
 *  Builds React nodes from plain strings (never dangerouslySetInnerHTML),
 *  so embedded HTML in a reply is rendered as inert text. Supports headings,
 *  bold, italic, inline code, http(s) links, and bullet/numbered lists.
 */

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/;

function renderInline(text, keyBase) {
  const nodes = [];
  let rest = String(text);
  let k = 0;
  let match = INLINE_PATTERN.exec(rest);
  while (match) {
    const [token, code, bold, italic, link] = match;
    const idx = match.index;
    if (idx > 0) nodes.push(rest.slice(0, idx));
    if (code) {
      nodes.push(
        <code key={`${keyBase}-${k++}`} className="rounded bg-stone-100 px-1 font-mono text-[13px]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(<strong key={`${keyBase}-${k++}`}>{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      nodes.push(<em key={`${keyBase}-${k++}`}>{italic.slice(1, -1)}</em>);
    } else if (link) {
      const cut = link.lastIndexOf("](");
      nodes.push(
        <a
          key={`${keyBase}-${k++}`}
          href={link.slice(cut + 2, -1)}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-pine-700 underline"
        >
          {link.slice(1, cut)}
        </a>,
      );
    }
    rest = rest.slice(idx + token.length);
    match = INLINE_PATTERN.exec(rest);
  }
  if (rest) nodes.push(rest);
  return nodes;
}

const isListItem = (line) => /^\s*[-*]\s+/.test(line);
const isOrderedItem = (line) => /^\s*\d+[.)]\s+/.test(line);
const isHeading = (line) => /^#{1,4}\s+/.test(line);

const HEADING_CLS = {
  1: "text-[15px] font-bold text-pine-950",
  2: "text-sm font-bold text-pine-950",
  3: "text-[13px] font-bold text-pine-900",
  4: "text-[13px] font-bold text-stone-700",
};

export default function Markdown({ text }) {
  const lines = String(text ?? "").split("\n");
  const blocks = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={b} className={`${HEADING_CLS[heading[1].length]} mt-2 first:mt-0`}>
          {renderInline(heading[2], `b${b}`)}
        </p>,
      );
      b++;
      i++;
      continue;
    }
    if (isListItem(line)) {
      const items = [];
      while (i < lines.length && isListItem(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={b} className="mt-1 list-disc space-y-0.5 pl-5">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, `b${b}u${j}`)}</li>
          ))}
        </ul>,
      );
      b++;
      continue;
    }
    if (isOrderedItem(line)) {
      const items = [];
      while (i < lines.length && isOrderedItem(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={b} className="mt-1 list-decimal space-y-0.5 pl-5">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, `b${b}o${j}`)}</li>
          ))}
        </ol>,
      );
      b++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isHeading(lines[i]) && !isListItem(lines[i]) && !isOrderedItem(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={b} className="mt-1 first:mt-0">
        {para.map((pl, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {renderInline(pl, `b${b}p${j}`)}
          </span>
        ))}
      </p>,
    );
    b++;
  }
  return <div className="space-y-1">{blocks}</div>;
}
