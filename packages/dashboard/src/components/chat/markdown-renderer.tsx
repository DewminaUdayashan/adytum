'use client';

/**
 * @file packages/dashboard/src/components/chat/markdown-renderer.tsx
 * @description Defines reusable UI components for the dashboard.
 */

import { clsx } from 'clsx';
import { Fragment, type ReactNode } from 'react';
import { sanitizeLinkUrl, stripTrailingPunctuation } from './markdown-utils';

type MarkdownVariant = 'assistant' | 'user';

type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; code: string; language?: string }
  | { kind: 'unordered-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' };

const INLINE_TOKEN_REGEX =
  /(`[^`\n]+`|!\[[^\]]*]\([^)]+\)|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<]+|~~[^~\n]+~~|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

export function MarkdownRenderer({
  content,
  variant = 'assistant',
  className,
}: {
  content: string;
  variant?: MarkdownVariant;
  className?: string;
}) {
  const blocks = parseMarkdownBlocks(content);
  const textTone = variant === 'user' ? 'text-white' : 'text-text-primary';
  const subtleTone = variant === 'user' ? 'text-white/80' : 'text-text-secondary';
  const borderTone = variant === 'user' ? 'border-white/20' : 'border-border-primary';
  const codeTone = variant === 'user' ? 'bg-white/10' : 'bg-bg-primary/60';

  return (
    <div className={clsx('space-y-2.5 text-sm leading-relaxed', textTone, className)}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const headingClass = getHeadingClass(block.level);
          return (
            <h3 key={`h-${index}`} className={headingClass}>
              {renderInlineMarkdown(block.text, variant, `h-${index}`)}
            </h3>
          );
        }

        if (block.kind === 'paragraph') {
          return (
            <p key={`p-${index}`}>{renderInlineMarkdown(block.text, variant, `p-${index}`)}</p>
          );
        }

        if (block.kind === 'unordered-list' || block.kind === 'ordered-list') {
          const ListTag = block.kind === 'ordered-list' ? 'ol' : 'ul';
          return (
            <ListTag
              key={`list-${index}`}
              className={clsx(
                'space-y-1.5 pl-5',
                block.kind === 'ordered-list' ? 'list-decimal' : 'list-disc',
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`list-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, variant, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.kind === 'blockquote') {
          return (
            <blockquote
              key={`quote-${index}`}
              className={clsx(
                'border-l-2 pl-3 italic',
                variant === 'user'
                  ? 'border-white/40 text-white/90'
                  : 'border-accent-primary/50 text-text-secondary',
              )}
            >
              {renderInlineMarkdown(block.text, variant, `quote-${index}`)}
            </blockquote>
          );
        }

        if (block.kind === 'code') {
          return (
            <div
              key={`code-${index}`}
              className={clsx(
                'overflow-auto rounded-lg border p-3 font-mono text-[12px] leading-5',
                borderTone,
                codeTone,
              )}
            >
              {block.language && (
                <p className={clsx('mb-2 text-[10px] uppercase tracking-wider', subtleTone)}>
                  {block.language}
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.kind === 'table') {
          return (
            <div
              key={`table-${index}`}
              className={clsx('overflow-auto rounded-lg border', borderTone)}
            >
              <table className="min-w-full border-collapse text-left text-[13px]">
                <thead className={clsx('border-b', borderTone)}>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={`table-${index}-h-${headerIndex}`}
                        className="px-3 py-2 font-semibold"
                      >
                        {renderInlineMarkdown(header, variant, `table-${index}-h-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr
                      key={`table-${index}-r-${rowIndex}`}
                      className={clsx('border-b last:border-b-0', borderTone)}
                    >
                      {block.headers.map((_, colIndex) => (
                        <td key={`table-${index}-${rowIndex}-${colIndex}`} className="px-3 py-2">
                          {renderInlineMarkdown(
                            row[colIndex] || '',
                            variant,
                            `table-${index}-${rowIndex}-${colIndex}`,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return <hr key={`hr-${index}`} className={clsx('border-t', borderTone)} />;
      })}
    </div>
  );
}

function renderInlineMarkdown(
  text: string,
  variant: MarkdownVariant,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;
  INLINE_TOKEN_REGEX.lastIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_REGEX)) {
    const start = match.index ?? 0;
    const token = match[0];

    if (start > cursor) {
      appendText(nodes, text.slice(cursor, start), `${keyPrefix}-text-${tokenIndex}`);
    }

    const rendered = renderInlineToken(token, variant, `${keyPrefix}-token-${tokenIndex}`);
    if (Array.isArray(rendered)) {
      nodes.push(...rendered);
    } else {
      nodes.push(rendered);
    }

    cursor = start + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    appendText(nodes, text.slice(cursor), `${keyPrefix}-tail`);
  }

  return nodes.length > 0 ? nodes : [''];
}

function renderInlineToken(
  token: string,
  variant: MarkdownVariant,
  key: string,
): ReactNode | ReactNode[] {
  if (token.startsWith('`') && token.endsWith('`')) {
    return (
      <code
        key={key}
        className={clsx(
          'rounded px-1 py-0.5 font-mono text-[12px]',
          variant === 'user' ? 'bg-white/15 text-white' : 'bg-bg-tertiary text-text-primary',
        )}
      >
        {token.slice(1, -1)}
      </code>
    );
  }

  if (token.startsWith('~~') && token.endsWith('~~')) {
    return (
      <del key={key} className="opacity-80">
        {renderInlineMarkdown(token.slice(2, -2), variant, `${key}-strike`)}
      </del>
    );
  }

  if (
    (token.startsWith('**') && token.endsWith('**')) ||
    (token.startsWith('__') && token.endsWith('__'))
  ) {
    return (
      <strong key={key} className="font-semibold">
        {renderInlineMarkdown(token.slice(2, -2), variant, `${key}-bold`)}
      </strong>
    );
  }

  if (
    (token.startsWith('*') && token.endsWith('*')) ||
    (token.startsWith('_') && token.endsWith('_'))
  ) {
    return (
      <em key={key} className="italic">
        {renderInlineMarkdown(token.slice(1, -1), variant, `${key}-italic`)}
      </em>
    );
  }

  if (token.startsWith('![')) {
    const imageMatch = token.match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (!imageMatch) return token;
    const href = sanitizeLinkUrl(stripTrailingPunctuation(imageMatch[2]));
    if (!href) return token;
    const label = imageMatch[1].trim() || 'image';
    return (
      <div key={key} className="my-2 space-y-1">
        <img
          src={href}
          alt={label}
          className="max-h-[300px] w-auto max-w-full rounded-lg border border-border-primary/50 shadow-sm"
          loading="lazy"
        />
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={clsx(getLinkClassName(variant), 'text-[11px] opacity-70')}
        >
          View original: {label}
        </a>
      </div>
    );
  }

  if (token.startsWith('[')) {
    const linkMatch = token.match(/^\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (!linkMatch) return token;
    const href = sanitizeLinkUrl(stripTrailingPunctuation(linkMatch[2]));
    if (!href) return linkMatch[1];

    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={getLinkClassName(variant)}
      >
        {renderInlineMarkdown(linkMatch[1], variant, `${key}-label`)}
      </a>
    );
  }

  if (token.startsWith('http://') || token.startsWith('https://')) {
    const cleanUrl = stripTrailingPunctuation(token);
    const trailing = token.slice(cleanUrl.length);
    const href = sanitizeLinkUrl(cleanUrl);

    if (!href) return token;

    return (
      <Fragment key={key}>
        <a href={href} target="_blank" rel="noreferrer" className={getLinkClassName(variant)}>
          {cleanUrl}
        </a>
        {trailing}
      </Fragment>
    );
  }

  return token;
}

function appendText(nodes: ReactNode[], text: string, keyPrefix: string): void {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
    if (lines[index]) {
      nodes.push(lines[index]);
    }
  }
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeFenceMatch = line.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (codeFenceMatch) {
      const language = codeFenceMatch[1];
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && /^```/.test(lines[index])) index += 1;
      blocks.push({ kind: 'code', code: codeLines.join('\n'), language });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    if (isTableHeader(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2; // Skip header + separator line
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: 'ordered-list', items });
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*+]\s+(.*)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: 'unordered-list', items });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStarter(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }

  return blocks;
}

function isBlockStarter(lines: string[], index: number): boolean {
  const line = lines[index] || '';
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^```/.test(trimmed)) return true;
  if (/^(#{1,6})\s+/.test(trimmed)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  if (/^\s*\d+\.\s+/.test(line)) return true;
  if (/^\s*[-*+]\s+/.test(line)) return true;
  if (isTableHeader(lines, index)) return true;

  return false;
}

function isTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = lines[index] || '';
  const separator = (lines[index + 1] || '').trim();

  if (!header.includes('|')) return false;
  if (!separator.includes('|')) return false;

  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator);
}

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => part.trim());
}

function getHeadingClass(level: number): string {
  if (level === 1) return 'text-xl font-semibold tracking-tight';
  if (level === 2) return 'text-lg font-semibold tracking-tight';
  if (level === 3) return 'text-base font-semibold';
  return 'text-sm font-semibold';
}

function getLinkClassName(variant: MarkdownVariant): string {
  return variant === 'user'
    ? 'underline decoration-white/50 hover:decoration-white break-all'
    : 'underline decoration-accent-primary/50 text-accent-primary hover:text-accent-secondary break-all';
}
