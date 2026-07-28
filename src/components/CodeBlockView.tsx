import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Icon } from './Icons';

/** The languages worth offering by name. Anything else still highlights by guess. */
const LANGUAGES = [
  ['', 'Auto'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['css', 'CSS'],
  ['diff', 'Diff'],
  ['go', 'Go'],
  ['graphql', 'GraphQL'],
  ['xml', 'HTML / XML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['kotlin', 'Kotlin'],
  ['lua', 'Lua'],
  ['markdown', 'Markdown'],
  ['objectivec', 'Objective-C'],
  ['php', 'PHP'],
  ['plaintext', 'Plain text'],
  ['python', 'Python'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scss', 'SCSS'],
  ['shell', 'Shell session'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['typescript', 'TypeScript'],
  ['yaml', 'YAML'],
];

/**
 * A code block with the two things a monospace box always wants: which language
 * it is, and a way to get the text back out. The bar only shows on hover, so a
 * note full of snippets still reads as prose.
 */
export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string) || '';

  const copy = () => {
    navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-tools" contentEditable={false}>
        {editor.isEditable && (
          <select
            className="code-lang"
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value || null })}
            aria-label="Language"
          >
            {LANGUAGES.map(([id, label]) => (
              <option key={id || 'auto'} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" onClick={copy} title="Copy code" aria-label="Copy code">
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      </div>
      <pre>
        <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
