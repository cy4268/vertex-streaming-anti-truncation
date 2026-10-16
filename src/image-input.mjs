// Text-to-image input (lossless WebP pages), inspired by Antigravity's experimental imagectx pipeline.
// No text, images or data URLs are written to disk or diagnostics.
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
export const IMAGE_INPUT_MODES = ['off', 'current-turn', 'all'];
const fail = (status, code) => Object.assign(new Error(code), { status, code });
// A bundled CJK font cannot faithfully render every control/emoji sequence.
// Text-presentation symbols such as ♥ © ™ are left to the glyph coverage check.
const UNSUPPORTED = /[\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;
// Exempt from glyph coverage: layout whitespace, and format characters that draw nothing
// (ZWSP, ZWNJ, WJ, BOM, VS15), so invisible pasted characters do not reject the request.
const NO_GLYPH = '\n\r\t\u200b\u200c\u2060\ufeff\ufe0e';
let canvasModule;
// The bundled font has a Unicode format-12 cmap. Check glyph coverage instead of
// relying on different host OS fallback fonts or silently emitting missing-glyph boxes.
function fontCoverage(font) {
  for (let table = 0; table < font.readUInt16BE(4); table++) {
    const record = 12 + table * 16;
    if (font.toString('ascii', record, record + 4) !== 'cmap') continue;
    const cmap = font.readUInt32BE(record + 8);
    for (let encoding = 0; encoding < font.readUInt16BE(cmap + 2); encoding++) {
      const entry = cmap + 4 + encoding * 8;
      if (font.readUInt16BE(entry) !== 0 && font.readUInt16BE(entry) !== 3) continue;
      const offset = cmap + font.readUInt32BE(entry + 4);
      if (font.readUInt16BE(offset) !== 12) continue;
      const groups = font.readUInt32BE(offset + 12);
      if (offset + 16 + groups * 12 > font.length) throw Error('invalid font');
      return point => {
        let low = 0, high = groups - 1;
        while (low <= high) {
          const middle = (low + high) >>> 1, pos = offset + 16 + middle * 12;
          const start = font.readUInt32BE(pos), end = font.readUInt32BE(pos + 4);
          if (point < start) high = middle - 1;
          else if (point > end) low = middle + 1;
          else return font.readUInt32BE(pos + 8) + point - start !== 0;
        }
        return false;
      };
    }
  }
  throw Error('Unicode font coverage unavailable');
}
async function renderer() {
  if (!canvasModule) canvasModule = import('@napi-rs/canvas').then(async mod => {
    const fontPath = fileURLToPath(new URL('../assets/fonts/NotoSansCJKsc-Regular.otf', import.meta.url));
    const covers = fontCoverage(await readFile(fontPath));
    if (!mod.GlobalFonts.registerFromPath(fontPath, 'RouterCJK')) throw Error('font unavailable');
    return { createCanvas: mod.createCanvas, covers };
  });
  try { return await canvasModule; } catch { throw fail(503, 'image_renderer_unavailable'); }
}
export function imageInputLogFields(value) {
  if (!value) return {};
  const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
  return { imageInput: { mode: IMAGE_INPUT_MODES.includes(value.mode) ? value.mode : 'off',
    reason: ['encoded', 'no-text'].includes(value.reason) ? value.reason : 'unknown',
    pages: count(value.pages), bytes: count(value.bytes), messages: count(value.messages) } };
}
export async function prepareImageInput(input, mode = 'off', limitBytes = 8 * 1024 * 1024, { signal } = {}) {
  if (!IMAGE_INPUT_MODES.includes(mode)) throw fail(400, 'invalid_image_input_mode');
  if (mode === 'off') return { payload: input, metadata: null };
  const metadata = { mode, reason: 'no-text', pages: 0, bytes: 0, messages: 0 };
  const source = input.messages;
  if (!Array.isArray(source)) throw fail(400, 'invalid_messages');
  const lastAssistant = mode === 'current-turn' ? source.findLastIndex(m => m?.role === 'assistant') : -1;
  // Preflight bounds work even before allocating the renderer. Never rasterize tool contracts.
  // Preserve system/developer instructions as text: Vertex systemInstruction is text-only.
  const eligible = (m, i) => i > lastAssistant && ['user','assistant'].includes(m?.role) &&
    !m.tool_calls && !m.function_call && !m.tool_call_id;
  let chars = 0;
  for (const [i,m] of source.entries()) if (eligible(m,i)) {
    const texts = typeof m.content === 'string' ? [m.content] : Array.isArray(m.content) ? m.content.map(p => typeof p === 'string' ? p : p?.type === 'text' ? p.text : '') : [];
    for (const text of texts) if (typeof text === 'string') chars += text.length;
  }
  if (chars > 150000) throw fail(413, 'image_input_too_large');
  if (!chars) return { payload: input, metadata };
  signal?.throwIfAborted();
  const { createCanvas, covers } = await renderer();
  const measure = createCanvas(1,1).getContext('2d');
  measure.font = '20px RouterCJK';
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  const widths = new Map();
  async function textParts(text, role, param) {
    if (!text.trim()) return [{type:'text', text}];
    // Keep input intact by failing explicitly, never replace unknown glyphs silently.
    // The client error names the part and code point; the message stays the fixed code.
    for (const character of text) {
      const point = character.codePointAt(0);
      if (UNSUPPORTED.test(character) || (!NO_GLYPH.includes(character) && !covers(point))) throw Object.assign(
        fail(400, 'image_input_unsupported_characters'), { param, character: 'U+' + point.toString(16).toUpperCase().padStart(4, '0') });
    }
    const lines=[];
    for (const raw of text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')) {
      // Sum cached grapheme widths: re-measuring the growing line made wrapping quadratic per line.
      // Summed widths drift on kerned pairs such as "(j" or "fV", so each line is measured once
      // when it closes; on overflow trailing graphemes covering the excess carry to the next line.
      let segs=[], width=0;
      const close = () => {
        let keep = segs.length, over = keep > 1 ? measure.measureText(segs.join('')).width - 960 : 0;
        while (over > 0) {
          while (over > 0 && keep > 1) over -= widths.get(segs[--keep]);
          over = keep > 1 ? measure.measureText(segs.slice(0,keep).join('')).width - 960 : 0;
        }
        lines.push(segs.slice(0,keep).join(''));
        segs = segs.slice(keep); width = segs.reduce((sum, s) => sum + widths.get(s), 0);
      };
      for (const {segment} of segmenter.segment(raw)) {
        let advance = widths.get(segment);
        if (advance === undefined) widths.set(segment, advance = measure.measureText(segment).width);
        while (segs.length && width + advance > 960) close();
        segs.push(segment); width+=advance;
      }
      do close(); while (segs.length);
    }
    const pageCount=Math.ceil(lines.length/36);
    if (metadata.pages+pageCount>100) throw fail(413,'image_input_too_large');
    const parts=[];
    for(let page=0;page<pageCount;page++) {
      signal?.throwIfAborted();
      const rows=lines.slice(page*36,(page+1)*36);
      const canvas=createCanvas(1024,Math.max(120,76+rows.length*28));
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#f8f9fa';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#e9ecef';ctx.fillRect(0,0,1024,42);
      ctx.font='20px RouterCJK';ctx.fillStyle='#212529';
      ctx.fillText(`[Role: ${role.toUpperCase()}] [Part ${page+1}/${pageCount}]`,28,29);
      rows.forEach((line,i)=>ctx.fillText(line,28,70+i*28));
      // In @napi-rs/canvas only quality 100 selects lossless WebP (VP8L); lower values are lossy.
      // Pixels decode identically to PNG; full prose pages are about 1.3-3x smaller, one-line pages slightly larger.
      const image=await canvas.encode('webp',100);
      metadata.pages++;metadata.bytes+=image.length;
      if(image.length>4*1024*1024 || metadata.bytes>12*1024*1024 || metadata.bytes*4/3>limitBytes) throw fail(413,'image_input_too_large');
      parts.push({type:'image_url',image_url:{url:'data:image/webp;base64,'+image.toString('base64')}});
    }
    return parts;
  }
  const messages=[];
  for(const [index,message] of source.entries()) {
    if(!eligible(message,index)){messages.push(message);continue;}
    const content=message.content;
    const parts=typeof content==='string'?[{type:'text',text:content}]:content;
    if(!Array.isArray(parts)){messages.push(message);continue;}
    const before=metadata.pages, converted=[];
    for(const [position,part] of parts.entries()) {
      const text=typeof part==='string'?part:part?.type==='text'?part.text:null;
      const param=typeof content==='string'?`/messages/${index}/content`:`/messages/${index}/content/${position}`;
      if(typeof text==='string' && (typeof part==='string' || Object.keys(part).every(k=>['type','text'].includes(k)))) converted.push(...await textParts(text,message.role,param));
      else converted.push(part);
    }
    if(metadata.pages>before){metadata.messages++;messages.push({...message,content:converted});}
    else messages.push(message);
  }
  if(!metadata.pages) return {payload:input,metadata};
  const payload={...input,messages};
  if(Buffer.byteLength(JSON.stringify(payload))>limitBytes) throw fail(413,'image_input_too_large');
  metadata.reason='encoded';
  return {payload,metadata};
}
