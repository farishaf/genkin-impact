import { useEffect, useRef, useState } from "react";

// Tags the editor keeps; every attribute is dropped. Anything else is unwrapped to its text, or dropped with its content.
const KEEP = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "P", "DIV", "BR", "UL", "OL", "LI", "H2", "H3", "BLOCKQUOTE"]);
const DROP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "NOSCRIPT", "TEXTAREA", "SELECT", "TITLE", "HEAD", "META", "LINK"]);

/** Allowlist sanitizer: notes are stored as HTML and rendered with innerHTML, so never trust what comes back. */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE || DROP.has((child as Element).tagName)) {
        child.remove();
        continue;
      }
      const el = child as Element;
      clean(el);
      if (!KEEP.has(el.tagName)) el.replaceWith(...el.childNodes);
      else for (const a of [...el.attributes]) el.removeAttribute(a.name);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

// Only the tags this editor writes mark a value as HTML, so plain text such as "x<y>" or "<three>" stays text.
const EDITOR_HTML = /<\/?(b|strong|i|em|u|s|strike|p|div|br|ul|ol|li|h2|h3|blockquote)\b[^>]*>/i;

/** Notes saved before rich text are plain text: escape them and keep their line breaks. */
function toRichHtml(value: string): string {
  if (EDITOR_HTML.test(value)) return sanitizeHtml(value);
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML.replace(/\n/g, "<br>");
}

type Cmd = "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList";
const TOOLS: { cmd: Cmd | "h2" | "quote"; label: string; text: string; key?: string }[] = [
  { cmd: "bold", label: "Bold", text: "B", key: "Ctrl+B" },
  { cmd: "italic", label: "Italic", text: "I", key: "Ctrl+I" },
  { cmd: "underline", label: "Underline", text: "U", key: "Ctrl+U" },
  { cmd: "strikeThrough", label: "Strikethrough", text: "S" },
  { cmd: "h2", label: "Heading", text: "H" },
  { cmd: "insertUnorderedList", label: "Bulleted list", text: "•" },
  { cmd: "insertOrderedList", label: "Numbered list", text: "1." },
  { cmd: "quote", label: "Quote", text: "❝" },
];
const STATE_CMDS: Cmd[] = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];

/** The block element (h2, blockquote, …) the caret sits in, if it is a direct child of the editor. */
function currentBlock(root: HTMLElement) {
  let n = window.getSelection()?.anchorNode ?? null;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n instanceof HTMLElement ? n.tagName : null;
}

/**
 * Small rich-text field: bold, italic, underline, strike, heading, lists, quote. Emits sanitized HTML.
 * ponytail: built on contentEditable + document.execCommand (deprecated, but every browser still ships it);
 * swap in a real editor (Tiptap, Lexical) if notes need tables, links or images.
 */
export function RichText({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Set<string>>(new Set());

  // Write the value into the DOM only when it changed from outside (load, another tab), never mid-typing: that would move the caret.
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const html = toRichHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [value]);

  useEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el || !el.contains(window.getSelection()?.anchorNode ?? null)) return;
      const on = new Set<string>(STATE_CMDS.filter((c) => document.queryCommandState(c)));
      const block = currentBlock(el);
      if (block === "H2") on.add("h2");
      if (block === "BLOCKQUOTE") on.add("quote");
      setActive(on);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // A cleared editor keeps a stray <br>; empty it so the placeholder shows again.
    if (!el.textContent?.trim() && !el.querySelector("li")) el.innerHTML = "";
    const html = sanitizeHtml(el.innerHTML);
    if (html !== value) onChange(html);
  };

  function run(cmd: (typeof TOOLS)[number]["cmd"]) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (cmd === "h2" || cmd === "quote") {
      const tag = cmd === "h2" ? "H2" : "BLOCKQUOTE";
      document.execCommand("formatBlock", false, currentBlock(el) === tag ? "P" : tag);
    } else {
      document.execCommand(cmd);
    }
    emit();
  }

  return (
    <div className={`rt ${className ?? ""}`}>
      <div className="rt__bar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            className={`rt__tool rt__tool--${t.cmd}`}
            aria-label={t.label}
            aria-pressed={active.has(t.cmd)}
            title={t.key ? `${t.label} (${t.key})` : t.label}
            // mousedown would move focus out of the editor and lose the selection the command applies to.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(t.cmd)}
          >
            {t.text}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="rt__area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // Keep structure (bold, lists) from pasted HTML but none of its styles, links or scripts.
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          if (html) document.execCommand("insertHTML", false, sanitizeHtml(html));
          else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(e) => {
          // Markdown-style starts: "- " or "* " makes a bulleted list, "1. " a numbered one.
          if (e.key !== " ") return;
          const sel = window.getSelection();
          const node = sel?.anchorNode;
          if (!sel?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return;
          const before = (node.textContent ?? "").slice(0, sel.anchorOffset);
          const cmd = before === "-" || before === "*" ? "insertUnorderedList" : before === "1." ? "insertOrderedList" : null;
          if (!cmd || node.parentElement?.closest("li")) return;
          e.preventDefault();
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, sel.anchorOffset);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("delete");
          document.execCommand(cmd);
          emit();
        }}
      />
    </div>
  );
}
