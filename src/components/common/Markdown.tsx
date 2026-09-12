import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { IoCheckmarkOutline, IoCopyOutline } from 'react-icons/io5';

interface Citation {
  title: string;
  url: string;
}

interface MarkdownProps {
  children: string;
  // Render citation markers like [1], [2] as links that open the referenced
  // source in a new tab. Used for search summaries.
  citations?: Citation[];
}

// Recursively extract plain text from rendered children (used for the copy button)
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

// Extract language from the code element's className (e.g. "language-ts")
function extractLanguage(node: ReactNode): string | null {
  if (React.isValidElement(node)) {
    const className = (node.props as { className?: string }).className;
    const match = className?.match(/language-(\w+)/);
    if (match) return match[1];
  }
  return null;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = extractLanguage(children);
  const codeText = extractText(children).replace(/\n$/, '');

  // Clear the pending "Copied" reset when the block unmounts
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="text-xs font-medium text-foreground/50">{language ?? 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <IoCheckmarkOutline className="w-3.5 h-3.5 text-green-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <IoCopyOutline className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

// Matches citation markers like [1], [2], [1][2] in plain text.
const CITATION_RE = /\[(\d+)\]/g;

/**
 * Split plain text on citation markers, linking known sources.
 * Unknown indexes are left as-is so nothing is silently dropped.
 */
function linkifyCitations(text: string, citations: Citation[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;

  while ((match = CITATION_RE.exec(text)) !== null) {
    const sourceIndex = parseInt(match[1], 10) - 1;
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const citation = citations[sourceIndex];
    if (citation) {
      parts.push(
        <a
          key={`cite-${match.index}-${match[1]}`}
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-xs font-medium text-primary hover:text-primary/80 transition-colors mx-0.5 no-underline"
          title={`Source: ${citation.title}`}
        >
          [{match[1]}]
        </a>,
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts;
}

function renderWithCitations(node: ReactNode, citations: Citation[]): ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') return node;
  if (typeof node === 'number') return node;
  if (typeof node === 'string') {
    if (!node.includes('[')) return node;
    const parts = linkifyCitations(node, citations);
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={i}>{renderWithCitations(child, citations)}</React.Fragment>
    ));
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    if (typeof node.type === 'string' && (node.type === 'a' || node.type === 'code')) {
      return node;
    }
    if (typeof node.type === 'string' && node.type === 'pre') return node;
    if (props.children === undefined) return node;
    return React.cloneElement(node, undefined, renderWithCitations(props.children, citations));
  }
  return node;
}

function withCitations<P extends { children?: ReactNode }>(
  Component: (props: P) => React.JSX.Element,
  citations: Citation[] | undefined,
) {
  if (!citations) return Component;
  return function CitedBlock(props: P) {
    return <Component {...props}>{renderWithCitations(props.children, citations)}</Component>;
  };
}

export function Markdown({ children, citations }: MarkdownProps) {
  const components: Components = useMemo(() => {
    const P = withCitations(
      ({ children: c }: { children?: ReactNode }) => <p>{c}</p>,
      citations,
    );
    const Li = withCitations(({ children: c }: { children?: ReactNode }) => <li>{c}</li>, citations);

    return {
      // Code blocks get a themed header with a copy button
      pre: ({ children: c }) => <CodeBlock>{c}</CodeBlock>,
      // Links open in a new tab
      a: ({ href, children: c }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {c}
        </a>
      ),
      // Tables scroll horizontally on small screens. A `<div>` wrapping a
      // top-level `<table>` is valid HTML (only div *inside* table/tr would
      // be invalid), so this overflow wrapper is safe here.
      table: ({ children: c }) => (
        <div className="md-table-wrapper">
          <table>{c}</table>
        </div>
      ),
      p: P,
      li: Li,
      h1: withCitations(({ children: c }: { children?: ReactNode }) => <h1>{c}</h1>, citations),
      h2: withCitations(({ children: c }: { children?: ReactNode }) => <h2>{c}</h2>, citations),
      h3: withCitations(({ children: c }: { children?: ReactNode }) => <h3>{c}</h3>, citations),
    };
  }, [citations]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // `rehype-raw` parses inline HTML generically into elements, then
      // `rehype-sanitize` (defaults) keeps the safe subset. `unwrapDisallowed`
      // keeps text inside unknown tags instead of dropping content.
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      unwrapDisallowed
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
