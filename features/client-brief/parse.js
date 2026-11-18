// Client Brief parser — pure, deterministic, no I/O, no LLM.
//
// Turns the Markdown-ish breakdown text an admin pastes (as ChatGPT writes it)
// into a small, safe model the renderer lays out. Inline markup is emitted as
// tokens ({t:'text'|'b'|'em'|'code'|'link'}) so the renderer never has to
// trust or re-parse raw text.
//
// Model:
//   { title, clientName, asOf,
//     intro: [{ tokens: Inline }],       // paragraphs before the first heading
//     sections: [{ heading, blocks: [
//       { type:'stats', rows:[{ label, value: Inline[] }] },
//       { type:'list',  ordered: boolean, items: [{ tokens: Inline }] },
//       { type:'para',  text: Inline[] },
//     ] }] }

export const CLIENT_BRIEF_MAX_CHARS = 50000;
export const CLIENT_BRIEF_DEFAULT_TITLE = 'Client Brief';

export class ClientBriefParseError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ClientBriefParseError';
    this.code = code;
  }
}

// ---------- inline ----------

const INLINE_RE = /\*\*([^*]+?)\*\*|`([^`\n]+?)`|\[([^\]\n]+?)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|(https?:\/\/[^\s<>()]+)/g;

export function safeHttpUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function pushText(tokens, value) {
  if (!value) return;
  const last = tokens[tokens.length - 1];
  if (last && last.t === 'text') last.v += value;
  else tokens.push({ t: 'text', v: value });
}

export function parseInline(input) {
  const text = String(input ?? '');
  const tokens = [];
  let cursor = 0;
  INLINE_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_RE.exec(text)) !== null) {
    pushText(tokens, text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      tokens.push({ t: 'b', v: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ t: 'code', v: match[2] });
    } else if (match[3] !== undefined) {
      const href = safeHttpUrl(match[4]);
      if (href) tokens.push({ t: 'link', v: match[3], href });
      else pushText(tokens, match[3]); // unsafe scheme: keep the label only
    } else if (match[5] !== undefined) {
      tokens.push({ t: 'em', v: match[5] });
    } else if (match[6] !== undefined) {
      // Bare URL: trim trailing punctuation that belongs to the sentence.
      const trimmed = match[6].replace(/[.,;:!?'"\]]+$/, '');
      const trailing = match[6].slice(trimmed.length);
      const href = safeHttpUrl(trimmed);
      if (href) {
        tokens.push({ t: 'link', v: trimmed, href });
        pushText(tokens, trailing);
      } else {
        pushText(tokens, match[6]);
      }
    }
  }
  pushText(tokens, text.slice(cursor));
  return tokens;
}

export function inlineToPlain(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((token) => token.v).join('');
}

// ---------- block helpers ----------

const FENCE_RE = /^\s*(```|~~~)/;
const RULE_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const ATX_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const BOLD_ONLY_RE = /^\s*\*\*([^*]+?)\*\*\s*:?\s*$/;
const BOLD_LABEL_RE = /^\s*\*\*([^*]+?)\*\*\s*:\s*(.+)$/; // **Label (x)**: value
const BOLD_COLON_INSIDE_RE = /^\s*\*\*([^*]+?):\*\*\s*(.+)$/; // **Label:** value
const PLAIN_LABEL_RE = /^\s*([A-Za-z0-9][^:*`\[\]|]{0,38}?):\s+(\S.*)$/; // Label: value
const BULLET_RE = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function stripFencedBlocks(lines) {
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      if (!inFence) {
        // Drop a bare "HITLOOP COMMAND" caption sitting right above the fence.
        while (out.length && out[out.length - 1].trim() === '') out.pop();
        if (out.length && /^\W*hitloop\s+command\W*$/i.test(out[out.length - 1])) out.pop();
      }
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

function plainLabel(raw) {
  return String(raw || '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

function isShortPlainLabel(label) {
  if (/^(https?|ftp|mailto)$/i.test(label)) return false;
  return label.split(/\s+/).length <= 5;
}

function classify(line) {
  if (!line.trim()) return { kind: 'blank' };
  if (RULE_RE.test(line)) return { kind: 'rule' };
  const atx = line.match(ATX_RE);
  if (atx) return { kind: 'heading', level: atx[1].length, text: plainLabel(atx[2]) };
  if (TABLE_SEP_RE.test(line) && line.includes('-') && line.includes('|')) return { kind: 'tablesep' };
  if (TABLE_ROW_RE.test(line)) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean);
    return { kind: 'bullet', text: cells.join(' · '), indent: 0 };
  }
  const bullet = line.match(BULLET_RE);
  if (bullet && !RULE_RE.test(line)) return { kind: 'bullet', text: bullet[3].trim(), indent: bullet[1].length, ordered: /\d/.test(bullet[2]) };
  const boldOnly = line.match(BOLD_ONLY_RE);
  if (boldOnly) return { kind: 'heading', level: 3, text: plainLabel(boldOnly[1]) };
  const boldColon = line.match(BOLD_COLON_INSIDE_RE) || line.match(BOLD_LABEL_RE);
  if (boldColon && plainLabel(boldColon[1]).length <= 80) {
    return { kind: 'stat', label: plainLabel(boldColon[1]), value: boldColon[2].trim() };
  }
  const plain = line.match(PLAIN_LABEL_RE);
  if (plain) {
    const label = plainLabel(plain[1]);
    if (label && isShortPlainLabel(label) && !plain[2].startsWith('//')) {
      return { kind: 'stat', label, value: plain[2].trim() };
    }
  }
  // "Key wins:" style caption — a short line ending in a colon.
  const caption = line.trim().match(/^([^:*`]{1,60}):$/);
  if (caption) return { kind: 'caption', text: plainLabel(caption[1]) };
  return { kind: 'text', text: line.trim().replace(/^>\s?/, '') };
}

// ---------- main ----------

export function parseClientBrief(rawText, options = {}) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new ClientBriefParseError('Paste the client breakdown text first.', 'empty');
  }
  if (rawText.length > CLIENT_BRIEF_MAX_CHARS) {
    throw new ClientBriefParseError(
      `Breakdown is too long (${rawText.length} characters). Keep it under ${CLIENT_BRIEF_MAX_CHARS}.`,
      'too_long'
    );
  }

  const lines = stripFencedBlocks(rawText.replace(/\r\n?/g, '\n').split('\n'));
  if (!lines.some((line) => line.trim())) {
    throw new ClientBriefParseError('Nothing left to publish after removing code blocks.', 'empty');
  }

  const explicitTitle = String(options.title || '').replace(/\s+/g, ' ').trim();
  let title = explicitTitle;

  const preface = { heading: '', blocks: [] };
  const sections = [];
  let current = preface;
  let paragraph = [];
  let listItems = null;
  let listOrdered = false;
  let lastStatsBlock = null; // merge label lines even across blank lines
  let sawContent = false;

  const addBlock = (block) => {
    current.blocks.push(block);
    sawContent = true;
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      addBlock({ type: 'para', text: parseInline(paragraph.join(' ')) });
      paragraph = [];
      lastStatsBlock = null;
    }
  };
  const flushList = () => {
    if (listItems) {
      addBlock({ type: 'list', ordered: listOrdered, items: listItems });
      listItems = null;
      lastStatsBlock = null;
    }
  };
  const flushAll = () => { flushParagraph(); flushList(); };
  const startSection = (heading) => {
    flushAll();
    lastStatsBlock = null;
    current = { heading, blocks: [] };
    sections.push(current);
    sawContent = true;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const item = classify(line);

    if (item.kind === 'blank') {
      flushParagraph();
      // A blank line also ends a list, but not a stats group (merged below).
      flushList();
      continue;
    }
    if (item.kind === 'tablesep') continue; // table header divider: keep the table's rows in one list
    if (item.kind === 'rule') {
      flushAll();
      lastStatsBlock = null;
      continue;
    }
    if (item.kind === 'heading') {
      if (!title && item.level === 1 && !sawContent) {
        title = item.text; // first H1 on its own is the document title
        continue;
      }
      startSection(item.text);
      continue;
    }
    if (item.kind === 'caption') {
      // Only a heading when a list/stat block follows; otherwise plain text.
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      const upcoming = next < lines.length ? classify(lines[next]).kind : 'blank';
      if (upcoming === 'bullet' || upcoming === 'stat') {
        startSection(item.text);
        continue;
      }
      paragraph.push(`${item.text}:`);
      continue;
    }
    if (item.kind === 'bullet') {
      flushParagraph();
      if (listItems && listOrdered !== Boolean(item.ordered)) flushList();
      if (!listItems) { listItems = []; listOrdered = Boolean(item.ordered); }
      listItems.push({ tokens: parseInline(item.text) });
      continue;
    }
    if (item.kind === 'stat') {
      flushAll();
      const row = { label: item.label, value: parseInline(item.value) };
      if (lastStatsBlock && current.blocks[current.blocks.length - 1] === lastStatsBlock) {
        lastStatsBlock.rows.push(row);
      } else {
        lastStatsBlock = { type: 'stats', rows: [row] };
        addBlock(lastStatsBlock);
      }
      continue;
    }
    // plain text: indented continuation of a bullet, else paragraph line
    if (listItems && /^\s+\S/.test(line) && !paragraph.length) {
      const last = listItems[listItems.length - 1];
      last.tokens.push(...parseInline(` ${item.text}`));
      continue;
    }
    flushList();
    paragraph.push(item.text);
  }
  flushAll();

  // Text before the first heading: all-paragraph preface -> intro; otherwise
  // it becomes a first untitled section so lists/stats are not lost.
  let intro = [];
  if (preface.blocks.length) {
    if (preface.blocks.every((block) => block.type === 'para')) {
      intro = preface.blocks.map((block) => ({ tokens: block.text }));
    } else {
      sections.unshift(preface);
    }
  }

  const finalSections = sections.filter((section) => section.heading || section.blocks.length);
  if (!intro.length && !finalSections.length) {
    throw new ClientBriefParseError('Nothing left to publish after cleaning the text.', 'empty');
  }

  return {
    title: title || CLIENT_BRIEF_DEFAULT_TITLE,
    clientName: String(options.clientName || '').replace(/\s+/g, ' ').trim(),
    asOf: String(options.asOf || '').trim(),
    intro,
    sections: finalSections,
  };
}

export default parseClientBrief;
