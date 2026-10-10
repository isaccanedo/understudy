import { Check, Copy } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { messages } from "@/lib/messages";

function renderInline(nodes: Inline[], keyPrefix = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "code":
        return <code key={key} className="md-code">{node.value}</code>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, `${key}.`)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, `${key}.`)}</em>;
      case "strike":
        return <s key={key}>{renderInline(node.children, `${key}.`)}</s>;
      case "link":
        return (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children, `${key}.`)}
          </a>
        );
      case "break":
        return <br key={key} />;
    }
  });
}

function CodeBlock({ lang, value, caret }: { lang: string; value: string; caret: ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  const t = messages.live;
  return (
    <div className="md-pre">
      <div className="md-pre-bar">
        <span>{lang || "text"}</span>
        <button type="button" onClick={copy} aria-label={copied ? t.copied : t.copyCode}>
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? t.copied : t.copyCode}
        </button>
      </div>
      <pre>
        <code>
          {value}
          {caret}
        </code>
      </pre>
    </div>
  );
}

function renderBlock(block: Block, key: string, caret: ReactNode): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return (
        <p key={key}>
          {renderInline(block.children)}
          {caret}
        </p>
      );
    case "heading":
      return (
        <p key={key} className={`md-h md-h${Math.min(block.level, 3)}`} role="heading" aria-level={Math.min(block.level + 2, 6)}>
          {renderInline(block.children)}
          {caret}
        </p>
      );
    case "code":
      return <CodeBlock key={key} lang={block.lang} value={block.value} caret={caret} />;
    case "rule":
      return <hr key={key} />;
    case "quote":
      return <blockquote key={key}>{renderBlocks(block.children, caret)}</blockquote>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}>
          {block.items.map((item, i) => (
            <li key={i} style={item.depth ? { marginLeft: `${item.depth * 1.1}em` } : undefined} data-depth={item.depth || undefined}>
              {renderInline(item.children)}
              {i === block.items.length - 1 ? caret : null}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

function renderBlocks(blocks: Block[], caret: ReactNode) {
  return blocks.map((block, i) => renderBlock(block, String(i), i === blocks.length - 1 ? caret : null));
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const caret = streaming ? <span className="typing-caret" aria-hidden /> : null;
  if (blocks.length === 0) return <div className="md">{caret && <p>{caret}</p>}</div>;
  return <div className="md">{renderBlocks(blocks, caret)}</div>;
}
