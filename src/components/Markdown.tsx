import { memo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

function CodeBlock(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = ref.current?.innerText ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="group relative">
      <pre ref={ref} {...props} />
      <button
        onClick={copy}
        className="absolute top-2 right-2 rounded-md bg-ink-800/90 p-1.5 text-ink-300 opacity-0 transition group-hover:opacity-100 hover:text-ink-100"
        title="Copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function Link(props: ComponentProps<"a">) {
  // Links would navigate the overlay webview away; show them as text instead.
  return <span className="text-sky-300 underline decoration-sky-300/40">{props.children}</span>;
}

export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div
      className={`answer-md selectable prose prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-[14px] prose-strong:text-ink-100 prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-white/8 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-pre:my-2`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: CodeBlock, a: Link }}
      >
        {text}
      </ReactMarkdown>
      {streaming && <span className="caret" />}
    </div>
  );
});
