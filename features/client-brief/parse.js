// Client Brief parser (v2) - pure, deterministic, no I/O, no LLM.
//
// Faithful Markdown -> flat, ordered block list, in SOURCE ORDER. Nothing is
// grouped, sectioned, numbered or reordered. Raw HTML is never interpreted:
// it is just text and the renderer escapes it.
//
// Model: { title, clientName, asOf, blocks: Block[] }
//   { type:'heading',    level:1-6, tokens }
//   { type:'paragraph',  tokens }
//   { type:'blockquote', paragraphs:[{ tokens }] }
//   { type:'list',       ordered, start, items:[{ tokens, sub?:{ ordered, start, items:[{ tokens }] } }] }
//   { type:'table',      align:['left'|'right'|'center'|''], header:{ cells:[{ tokens }] }, rows:[{ cells:[{ tokens }] }] }
//   { type:'hr' }
//   { type:'code',       lang, text }
// Inline tokens: {t:'text',v} {t:'code',v} {t:'br'} {t:'b'|'em'|'bem', c:Token[]}
//   {t:'link', href, c:Token[]}.
// Firestore-safe: no array directly contains an array (table rows are
// `{ cells }` objects).

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

const INLINE_RE = new RegExp([
  '\\\\([\\\\`*_{}\\[\\]()#+\\-.!|>~<])',                                  // 1 escape
  '`([^`\\n]+?)`',                                                          // 2 code
  '\\[((?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\])+)\\]\\(\\s*((?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\s*\\)', // 3 label, 4 href
  '\\*\\*\\*(?=\\S)([^\\n]+?)(?<=\\S)\\*\\*\\*',                            // 5 bold-italic
  '\\*\\*(?=\\S)([^\\n]+?)(?<=\\S)\\*\\*(?!\\*)',                                  // 6 bold
  '(?<![_\\w])__(?=\\S)([^\\n]+?)(?<=\\S)__(?![_\\w])',                     // 7 bold (underscore)
  '(?<![*\\w])\\*(?=[^\\s*])([^*\\n]+?)(?<=[^\\s*])\\*(?![*\\w])',          // 8 italic
  '(?<![_\\w])_(?=[^\\s_])([^_\\n]+?)(?<=[^\\s_])_(?![_\\w])',              // 9 italic (underscore)
  '<((?:https?:\\/\\/|mailto:)[^\\s<>]+)>',                                 // 10 <autolink>
  '(https?:\\/\\/[^\\s<>()]+)',                                             // 11 bare URL
].join('|'), 'g');

// http(s) and mailto only; anything else is not a link.
export function safeLinkUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
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

const MAX_DEPTH = 3;

export function parseInline(input, depth = 0) {
  const text = String(input ?? '');
  const tokens = [];
  let cursor = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    pushText(tokens, text.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const nest = (s) => (depth + 1 < MAX_DEPTH ? parseInline(s, depth + 1) : [{ t: 'text', v: s }]);
    if (m[1] !== undefined) pushText(tokens, m[1]);
    else if (m[2] !== undefined) tokens.push({ t: 'code', v: m[2] });
    else if (m[3] !== undefined) {
      const href = safeLinkUrl(m[4]);
      if (href) tokens.push({ t: 'link', href, c: depth === 0 ? nest(m[3]) : [{ t: 'text', v: m[3] }] });
      else pushText(tokens, m[3]); // unsafe scheme: label only, as text
    } else if (m[5] !== undefined) tokens.push({ t: 'bem', c: nest(m[5]) });
    else if (m[6] !== undefined || m[7] !== undefined) tokens.push({ t: 'b', c: nest(m[6] ?? m[7]) });
    else if (m[8] !== undefined || m[9] !== undefined) tokens.push({ t: 'em', c: nest(m[8] ?? m[9]) });
    else if (m[10] !== undefined) {
      const href = safeLinkUrl(m[10]);
      if (href) tokens.push({ t: 'link', href, c: [{ t: 'text', v: m[10] }] });
      else pushText(tokens, m[0]);
    } else if (m[11] !== undefined) {
      const trimmed = m[11].replace(/[.,;:!?'"\]]+$/, '');
      const trailing = m[11].slice(trimmed.length);
      const href = safeLinkUrl(trimmed);
      if (href) {
        tokens.push({ t: 'link', href, c: [{ t: 'text', v: trimmed }] });
        pushText(tokens, trailing);
      } else pushText(tokens, m[11]);
    }
  }
  pushText(tokens, text.slice(cursor));
  return tokens;
}

export function inlineToPlain(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((token) => {
    if (!token) return '';
    if (token.t === 'br') return ' ';
    if (Array.isArray(token.c)) return inlineToPlain(token.c);
    return token.v || '';
  }).join('');
}

// Lines of one paragraph -> tokens, each pasted line break kept as a <br>.
function inlineLines(lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ t: 'br' });
    out.push(...parseInline(line.replace(/(?:\s{2,}|\\)$/, '').trim()));
  });
  return out;
}

// ---------- block patterns ----------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ATX_RE = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const COMMAND_RE = /^\W*hitloop\s+command\W*$/i;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i += 1; } else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('|') && TABLE_SEP_RE.test(lines[i + 1]);
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE_RE.test(line) || HR_RE.test(line) || ATX_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line) || isTableStart(lines, i);
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

  const lines = rawText.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks = [];
  let i = 0;

  const pushBlock = (b) => { blocks.push(b); };
  const dropCommandCaption = () => {
    // A bare "HITLOOP COMMAND" caption right above a stripped fence goes too.
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'paragraph' && COMMAND_RE.test(inlineToPlain(last.tokens))) blocks.pop();
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    // fenced code
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      const info = fence[2].trim();
      const body = [];
      i += 1;
      while (i < lines.length) {
        const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { i += 1; break; }
        body.push(lines[i]);
        i += 1;
      }
      const firstLine = (body.find((l) => l.trim()) || '').trim();
      const prev = blocks[blocks.length - 1];
      const captioned = prev && prev.type === 'paragraph' && COMMAND_RE.test(inlineToPlain(prev.tokens));
      if (captioned || /^\W*hitloop\s+command\b/i.test(info) || COMMAND_RE.test(firstLine)) {
        dropCommandCaption();
        continue;
      }
      pushBlock({ type: 'code', lang: info.split(/\s+/)[0].slice(0, 30), text: body.join('\n') });
      continue;
    }

    if (HR_RE.test(line)) { pushBlock({ type: 'hr' }); i += 1; continue; }

    const atx = line.match(ATX_RE);
    if (atx) {
      pushBlock({ type: 'heading', level: atx[1].length, tokens: parseInline(atx[2].trim()) });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const paragraphs = [];
      let current = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        const inner = lines[i].match(QUOTE_RE)[1];
        if (!inner.trim()) { if (current.length) paragraphs.push(current); current = []; } else current.push(inner);
        i += 1;
      }
      if (current.length) paragraphs.push(current);
      pushBlock({ type: 'blockquote', paragraphs: paragraphs.map((p) => ({ tokens: inlineLines(p) })) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const headerCells = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':'); const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      const width = headerCells.length;
      const fit = (cells) => Array.from({ length: Math.max(width, cells.length) }, (_, k) => ({ tokens: parseInline(cells[k] || '') }));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE_RE.test(lines[i])) {
        rows.push({ cells: fit(splitRow(lines[i])) });
        i += 1;
      }
      pushBlock({
        type: 'table',
        align: Array.from({ length: width }, (_, k) => align[k] || ''),
        header: { cells: fit(headerCells) },
        rows,
      });
      continue;
    }

    const first = line.match(LIST_RE);
    if (first) {
      const baseIndent = first[1].length;
      const ordered = /\d/.test(first[2]);
      const list = { type: 'list', ordered, start: ordered ? Math.max(0, parseInt(first[2], 10) || 1) : 1, items: [] };
      let item = null;
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) {
          // a blank line continues the list only if the next non-blank is a list item
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          const nm = j < lines.length ? lines[j].match(LIST_RE) : null;
          if (nm && (nm[1].length > baseIndent + 1 || (nm[1].length <= baseIndent + 1 && /\d/.test(nm[2]) === ordered))) { i = j; continue; }
          break;
        }
        const m = cur.match(LIST_RE);
        if (m) {
          const indent = m[1].length;
          const itemOrdered = /\d/.test(m[2]);
          if (indent <= baseIndent + 1) {
            if (itemOrdered !== ordered) break; // different list kind at top level: new list
            item = { tokens: parseInline(m[3].trim()) };
            list.items.push(item);
          } else if (item) {
            if (!item.sub) item.sub = { ordered: itemOrdered, start: itemOrdered ? Math.max(0, parseInt(m[2], 10) || 1) : 1, items: [] };
            item.sub.items.push({ tokens: parseInline(m[3].trim()) }); // deeper levels flatten
          }
          i += 1;
          continue;
        }
        if (/^\s+\S/.test(cur) && item) {
          // continuation of the current (sub)item
          const target = item.sub ? item.sub.items[item.sub.items.length - 1] : item;
          target.tokens.push({ t: 'br' }, ...parseInline(cur.trim()));
          i += 1;
          continue;
        }
        break;
      }
      pushBlock(list);
      continue;
    }

    // paragraph: consecutive lines until a blank or another block starts
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { para.push(lines[i]); i += 1; }
    pushBlock({ type: 'paragraph', tokens: inlineLines(para) });
  }

  if (!blocks.length) {
    throw new ClientBriefParseError('Nothing left to publish after removing the command block.', 'empty');
  }

  const explicitTitle = String(options.title || '').replace(/\s+/g, ' ').trim();
  const firstH1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  const title = explicitTitle || (firstH1 ? inlineToPlain(firstH1.tokens).trim().slice(0, 140) : '') || CLIENT_BRIEF_DEFAULT_TITLE;

  return {
    title,
    clientName: String(options.clientName || '').replace(/\s+/g, ' ').trim(),
    asOf: String(options.asOf || '').trim(),
    blocks,
  };
}

export default parseClientBrief;
