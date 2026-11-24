import { Fragment, type ReactNode } from "react";

/** **bold** inside a line, as React nodes. Nothing is parsed as HTML. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <b key={i}>{part.slice(2, -2)}</b>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

/**
 * The small part of Markdown that Kleidi Assist's summaries use: headings, bullet lists, bold
 * and paragraphs. It renders text only, so a summary can never inject markup.
 */
export function SimpleMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} style={{ margin: "6px 0", paddingLeft: 20 }}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (para.length) {
      blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
      para = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(
        <h3 key={blocks.length} style={{ margin: "8px 0 4px", fontSize: 16 }}>
          {inline(heading[2]!)}
        </h3>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) flush();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
