// Markdown → .docx（Word）导出：纯 JS 生成，不依赖 Office / 外部服务
// 用法： const { markdownToDocx } = require('./lib/docx-export');
//        const buf = await markdownToDocx({ title, content, uploadsDir });
const fs = require('fs');
const path = require('path');
const marked = require('marked');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, ImageRun
} = require('docx');

const HEADINGS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6
];
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '微软雅黑' };
const MONO = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '微软雅黑' };
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };

// ---- 图片尺寸（PNG / JPEG / GIF），用于等比缩放 ----
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ---- 图片类型（docx 的 ImageRun 必须显式声明 type，否则 Word 打不开）----
function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length > 2 && buf.toString('ascii', 0, 2) === 'BM') return 'bmp';
  return null;
}

// ---- 行内 Markdown → TextRun 列表 ----
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]*\]\([^)\s]+\))/g;

function inlineRuns(text, { bold = false, italic = false, code = false } = {}) {
  const runs = [];
  const push = (t, opts = {}) => {
    if (!t) return;
    runs.push(new TextRun({
      text: t,
      bold: opts.bold ?? bold,
      italics: opts.italic ?? italic,
      font: opts.code || code ? MONO : FONT,
      color: opts.code || code ? 'B91C1C' : undefined,
      size: opts.code || code ? 19 : undefined
    }));
  };
  const parts = String(text).split(INLINE_RE);
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[\s\S]+\*\*$/.test(part) || /^__[\s\S]+__$/.test(part)) push(part.slice(2, -2), { bold: true });
    else if (/^\*[\s\S]+\*$/.test(part) || /^_[\s\S]+_$/.test(part)) push(part.slice(1, -1), { italic: true });
    else if (/^`[\s\S]+`$/.test(part)) push(part.slice(1, -1), { code: true });
    else if (/^\[[^\]]*\]\([^)\s]+\)$/.test(part)) {
      const m = part.match(/^\[([^\]]*)\]\(([^)\s]+)\)$/);
      const label = m[1] || m[2];
      push(label, { bold, italic });
      if (label !== m[2]) push('（' + m[2] + '）', { italic: true });
    } else push(part);
  }
  if (!runs.length) runs.push(new TextRun({ text: '', font: FONT }));
  return runs;
}

function codeParagraph(code) {
  const lines = String(code).replace(/\s+$/, '').split('\n');
  const children = [];
  lines.forEach((line, i) => {
    children.push(new TextRun({ text: line || ' ', font: MONO, size: 18, break: i ? 1 : 0 }));
  });
  return new Paragraph({
    children,
    shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
    spacing: { before: 60, after: 60, line: 260 },
    indent: { left: 120, right: 120 },
    border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
  });
}

function tableFromToken(token) {
  const width = Math.floor(100 / Math.max(token.header.length, 1));
  const cell = (content, isHeader) => new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: 'EEF2FF' } : undefined,
    children: [new Paragraph({
      children: inlineRuns(content, { bold: isHeader }),
      spacing: { before: 40, after: 40 }
    })]
  });
  const rows = [
    new TableRow({ tableHeader: true, children: token.header.map(h => cell(h.text, true)) }),
    ...token.rows.map(r => new TableRow({ children: r.map(c => cell(c.text, false)) }))
  ];
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function listParagraphs(token, depth, out) {
  token.items.forEach((item, i) => {
    const marker = item.task ? (item.checked ? '☑ ' : '☐ ') : (token.ordered ? (i + 1) + '. ' : '• ');
    const textToken = (item.tokens || []).find(t => t.type === 'text' || t.type === 'paragraph');
    const text = textToken ? (textToken.text || '') : '';
    out.push(new Paragraph({
      children: [new TextRun({ text: marker, font: FONT })].concat(inlineRuns(text)),
      spacing: { before: 20, after: 20 },
      indent: { left: 240 + depth * 240, hanging: 240 }
    }));
    (item.tokens || []).filter(t => t.type === 'list').forEach(sub => listParagraphs(sub, depth + 1, out));
    if (textToken && textToken.tokens) {
      (textToken.tokens || []).filter(t => t.type === 'list').forEach(sub => listParagraphs(sub, depth + 1, out));
    }
  });
}

function imageParagraph(token, uploadsDir) {
  const img = (token.tokens || []).find(t => t.type === 'image');
  if (!img || !uploadsDir) return null;
  try {
    const name = path.basename(String(img.href).split('?')[0]);
    const file = path.join(uploadsDir, name);
    if (!file.startsWith(path.resolve(uploadsDir))) return null;
    const buf = fs.readFileSync(file);
    const type = imageType(buf);
    if (!type) return null; // webp/svg 等 docx 不支持的格式：交给调用方留占位文字
    const size = imageSize(buf) || { width: 600, height: 400 };
    const maxW = 460;
    const scale = size.width > maxW ? maxW / size.width : 1;
    return new Paragraph({
      children: [new ImageRun({
        type,
        data: buf,
        transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
      })],
      spacing: { before: 120, after: 120 }
    });
  } catch (e) { return null; }
}

// 段落：可能混着文字与多张图片（连续几行 ![](...) 会被 marked 合成一个段落）
function paragraphBlocks(token, ctx, out) {
  const inline = token.tokens || [];
  if (!inline.length) {
    const text = token.text || '';
    if (text.trim()) out.push(new Paragraph({ children: inlineRuns(text), spacing: { before: 40, after: 120, line: 300 } }));
    return;
  }
  if (!inline.some(t => t.type === 'image')) {
    const text = token.text || '';
    if (text.trim()) out.push(new Paragraph({ children: inlineRuns(text), spacing: { before: 40, after: 120, line: 300 } }));
    return;
  }
  let buffer = [];
  const flush = () => {
    const text = buffer.join('');
    buffer = [];
    if (text.trim()) out.push(new Paragraph({ children: inlineRuns(text), spacing: { before: 40, after: 120, line: 300 } }));
  };
  for (const t of inline) {
    if (t.type === 'image') {
      flush();
      const para = imageParagraph({ tokens: [t] }, ctx.uploadsDir);
      if (para) out.push(para);
      else buffer.push('（图片' + (t.text ? '：' + t.text : '') + '）');
    } else {
      buffer.push(t.raw !== undefined ? t.raw : (t.text || ''));
    }
  }
  flush();
}

function blocksFromTokens(tokens, ctx, out) {
  for (const token of tokens || []) {
    switch (token.type) {
      case 'heading':
        out.push(new Paragraph({
          children: inlineRuns(token.text),
          heading: HEADINGS[Math.min(Math.max(token.depth, 1), 6) - 1],
          spacing: { before: 280, after: 120 }
        }));
        break;
      case 'paragraph': {
        paragraphBlocks(token, ctx, out);
        break;
      }
      case 'code':
        out.push(codeParagraph(token.text || ''));
        break;
      case 'blockquote':
        blocksFromTokens(token.tokens, ctx, out);
        break;
      case 'list':
        listParagraphs(token, 0, out);
        break;
      case 'table':
        out.push(tableFromToken(token));
        out.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        break;
      case 'hr':
        out.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '94A3B8' } }, spacing: { before: 120, after: 160 } }));
        break;
      case 'html':
        break;
      default:
        if (token.text && token.text.trim()) out.push(new Paragraph({ children: inlineRuns(token.text), spacing: { after: 100 } }));
    }
  }
}

async function markdownToDocx({ title, content, uploadsDir, meta }) {
  const tokens = marked.lexer(content || '');
  const children = [
    new Paragraph({
      children: [new TextRun({ text: title || '未命名笔记', bold: true, size: 40, font: FONT })],
      spacing: { after: 120 }
    }),
    new Paragraph({
      children: [new TextRun({ text: meta || '', size: 18, color: '64748B', font: FONT })],
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } }
    })
  ];
  blocksFromTokens(tokens, { uploadsDir }, children);
  const doc = new Document({
    creator: 'MyNote',
    title: title || 'MyNote 导出',
    description: '由 MyNote 导出的 Markdown 笔记',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      children
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { markdownToDocx, imageSize };
