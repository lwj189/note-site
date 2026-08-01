const express = require('express');
const multer = require('multer');
const { marked } = require('marked');
const hljs = require('highlight.js');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---- Config ----
const PORT = process.env.PORT || 3000;
const SITE_TITLE = process.env.SITE_TITLE || 'MyNote';
const GIT_TOKEN = process.env.GIT_TOKEN || '';
const GIT_REPO = process.env.GIT_REPO || 'github.com/lwj189/note-site.git';
const GIT_USER = process.env.GIT_USER || 'lwj189';
const DATA_DIR = path.join(__dirname, 'data');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
const NOTEBOOKS_FILE = path.join(DATA_DIR, 'notebooks.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---- Data helpers ----
// ---- Data helpers (cached) ----
let notesCache = null;
let notebooksCache = null;
let flushTimer = null;

function initCache() {
  try {
    if (!fs.existsSync(NOTES_FILE)) notesCache = [];
    else notesCache = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
  } catch { notesCache = []; }
  try {
    if (!fs.existsSync(NOTEBOOKS_FILE)) notebooksCache = [];
    else notebooksCache = JSON.parse(fs.readFileSync(NOTEBOOKS_FILE, 'utf-8'));
  } catch { notebooksCache = []; }
}
initCache();

function loadNotes() { return notesCache; }

function loadActiveNotes() {
  return notesCache.filter(n => !n.deletedAt);
}

function saveNotes(notes) {
  notesCache = notes;
  scheduleFlush();
}

function loadNotebooks() { return notebooksCache; }

function saveNotebooks(notebooks) {
  notebooksCache = notebooks;
  scheduleFlush();
}

// Normalize notebook format (support old string[] and new object[])
function getNotebookNames() {
  return loadNotebooks().map(n => typeof n === 'string' ? n : n.name);
}

function getNotebookColor(name) {
  const nb = loadNotebooks().find(n => (typeof n === 'string' ? n : n.name) === name);
  if (!nb) return '#4361ee';
  return typeof nb === 'string' ? '#4361ee' : (nb.color || '#4361ee');
}

function getNotebookIcon(name) {
  const nb = loadNotebooks().find(n => (typeof n === 'string' ? n : n.name) === name);
  if (!nb) return '📁';
  return typeof nb === 'string' ? '📁' : (nb.icon || '📁');
}

function saveNotebooks(notebooks) {
  notebooksCache = notebooks;
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(NOTES_FILE, JSON.stringify(notesCache, null, 2));
      fs.writeFileSync(NOTEBOOKS_FILE, JSON.stringify(notebooksCache, null, 2));
    } catch (err) {
      console.error('[cache] write error:', err.message);
    }
  }, 500);
}

function highlightKeyword(text, keyword) {
  if (!keyword || !text) return esc(text);
  const escaped = esc(text);
  const kw = esc(keyword).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return escaped.replace(new RegExp('(' + kw + ')', 'gi'), '<mark>$1</mark>');
}

// ---- Git auto-sync ----
const { execFile } = require('child_process');

function gitExec(args) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: __dirname, timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject({ err, stdout, stderr });
        else resolve(stdout);
      }
    );
    // If GIT_TOKEN is set, supply credentials via stdin (not command line)
    if (GIT_TOKEN && args[0] === 'push') {
      child.stdin.write(`protocol=https\nhost=github.com\nusername=${GIT_USER}\npassword=${GIT_TOKEN}\n`);
      child.stdin.end();
    }
  });
}

let gitDebounceTimer = null;

let gitState = { status: 'idle', lastSync: null, lastError: null };

function debouncedGitSync() {
  if (!GIT_TOKEN) return;
  gitState.status = 'pending';
  if (gitDebounceTimer) clearTimeout(gitDebounceTimer);
  gitDebounceTimer = setTimeout(() => {
    gitDebounceTimer = null;
    gitSync();
  }, 10000);
}

async function gitSync() {
  if (!GIT_TOKEN) {
    console.log('[git] GIT_TOKEN not set, skip auto-sync');
    gitState.status = 'disabled';
    return;
  }
  gitState.status = 'syncing';
  try {
    await gitExec(['add', 'data/']);
    try {
      await gitExec(['-c', `user.name=${GIT_USER}`, '-c', `user.email=${GIT_USER}@users.noreply.github.com`, 'commit', '-m', 'auto: update notes']);
    } catch (e) {
      if (e.stderr && (e.stderr.includes('nothing to commit') || e.stderr.includes('nothing added'))) {
        console.log('[git] nothing to commit, skip');
        gitState.status = 'done';
        gitState.lastSync = new Date().toISOString();
        gitState.lastError = null;
        return;
      }
      throw e;
    }
    // Store credential via stdin helper, then push (URL without token)
    await gitExec(['-c', 'credential.helper=', '-c', `credential.helper=!f() { echo "username=${GIT_USER}"; echo "password=${GIT_TOKEN}"; }; f`, 'push', 'origin', 'main']);
    console.log('[git] sync done');
    gitState.status = 'done';
    gitState.lastSync = new Date().toISOString();
    gitState.lastError = null;
  } catch (err) {
    console.error(`[git] error: ${err.stderr || err.message}`);
    gitState.status = 'error';
    gitState.lastError = (err.stderr || err.message || '未知错误').slice(0, 300);
  }
}

// ---- Marked config ----
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

// ---- Express setup ----
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(UPLOADS_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Security headers ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// ---- Multer setup ----
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['.txt', '.cpp', '.md', '.h', '.hpp', '.c', '.py', '.js', '.ts', '.java', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.sql', '.sh', '.bat', '.ps1', '.docx'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename(req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// ---- Helpers ----
const LANG_MAP = {
  '.cpp': 'cpp', '.c': 'c', '.h': 'c', '.hpp': 'cpp',
  '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
  '.java': 'java', '.cs': 'csharp', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php', '.html': 'xml', '.css': 'css',
  '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
  '.sql': 'sql', '.sh': 'bash', '.bat': 'dos', '.ps1': 'powershell',
  '.md': 'md', '.txt': 'txt'
};

function renderContent(note) {
  if (note.type === 'md') return marked.parse(wikiLinkify(note.content));
  if (note.type === 'txt') return '<pre class="plain">' + esc(note.content) + '</pre>';
  return marked.parse('```' + note.type + '\n' + note.content + '\n```');
}

// 双链：把 [[标题]] / [[标题|显示文字]] 渲染为指向对应笔记的链接，未创建的笔记显示为灰色占位
function wikiLinkify(content) {
  const notes = loadActiveNotes();
  const byTitle = new Map();
  notes.forEach(n => byTitle.set(n.title, n.slug));
  const resolve = (name) => byTitle.get(name) || (notes.some(n => n.slug === name) ? name : null);
  // 保留围栏代码块原样，只处理代码块外的 [[...]]
  return content.split(/(```[\s\S]*?```)/g).map((seg, i) => {
    if (i % 2 === 1) return seg;
    return seg.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, name, display) => {
      const text = (display || name).trim();
      const slug = resolve(name.trim());
      if (slug) return '<a href="/note/' + encodeURIComponent(slug) + '" class="wikilink">' + esc(text) + '</a>';
      return '<span class="wikilink-unresolved" title="尚未创建该笔记">' + esc(text) + '</span>';
    });
  }).join('');
}

// 反向链接：找出内容中通过 [[标题]]/[[slug]] 引用了该笔记的其他笔记
function getBacklinks(note) {
  const notes = loadActiveNotes();
  const byTitle = new Map();
  notes.forEach(n => byTitle.set(n.title, n.slug));
  const refs = (content) => [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim());
  return notes.filter(n => n.slug !== note.slug && n.content.includes('[[') &&
    refs(n.content).some(name => (byTitle.get(name) === note.slug) || name === note.slug));
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validSlug(s) {
  return /^[\w一-鿿\-\+]+$/.test(s);
}

function listImages() {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  return fs.readdirSync(UPLOADS_DIR)
    .filter(f => exts.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(UPLOADS_DIR, f));
      return {
        filename: f, url: '/img/' + f,
        size: stat.size, sizeFmt: formatSize(stat.size),
        date: stat.mtime.toISOString(),
        dateFmt: stat.mtime.toLocaleDateString('zh-CN')
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Comparator prefix: pinned notes always come first
function pinnedFirst(a, b) {
  return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
}

// ---- Public routes ----

app.get('/', (req, res) => {
  const editSlug = req.query.edit || '';
  const notes = loadActiveNotes();
  notes.sort((a, b) => pinnedFirst(a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));
  const editNote = editSlug ? notes.find(n => n.slug === editSlug) : null;
  res.render('home', { notes, notebooks: loadNotebooks().map(n => ({ name: typeof n === 'string' ? n : n.name, color: typeof n === 'string' ? '#4361ee' : (n.color || '#4361ee'), icon: typeof n === 'string' ? '📁' : (n.icon || '📁'), count: notes.filter(x => x.tags && x.tags.includes(typeof n === 'string' ? n : n.name)).length })), site: SITE_TITLE, current: 'home', query: '', editNote });
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const timeFilter = req.query.time || '';
  const dateFrom = req.query.from || '';
  const dateTo = req.query.to || '';
  let notes = loadActiveNotes();

  // Time filter
  if (timeFilter || (dateFrom && dateTo)) {
    let from = 0;
    const to = Date.now();
    if (dateFrom) { from = new Date(dateFrom).getTime(); }
    else if (timeFilter === 'today') {
      const d = new Date(); d.setHours(0,0,0,0); from = d.getTime();
    } else if (timeFilter === 'week') {
      from = Date.now() - 7 * 24 * 3600 * 1000;
    } else if (timeFilter === 'month') {
      from = Date.now() - 30 * 24 * 3600 * 1000;
    }
    notes = notes.filter(n => {
      const t = new Date(n.updatedAt).getTime();
      return t >= from && t <= to;
    });
  }

  // Search
  let titleMatches = [], contentMatches = [];
  if (q) {
    notes.forEach(n => {
      if (n.title.toLowerCase().includes(q)) {
        titleMatches.push(n);
      } else if (n.content.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)) {
        contentMatches.push(n);
      }
    });
  } else {
    titleMatches = notes;
  }

  titleMatches.sort((a, b) => pinnedFirst(a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));
  contentMatches.sort((a, b) => pinnedFirst(a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));

  res.render('search', {
    notes, site: SITE_TITLE, current: 'search', query: q,
    titleMatches, contentMatches, timeFilter, dateFrom, dateTo,
    highlightKeyword
  });
});

app.get('/note/:slug', (req, res) => {
  const note = loadActiveNotes().find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).render('404', { site: SITE_TITLE });
  const backlinks = getBacklinks(note);
  res.render('note', { note, html: renderContent(note), backlinks, site: SITE_TITLE, current: 'note' });
});

app.get('/new', (req, res) => {
  const quick = req.query.quick === '1';
  const prefill = quick ? {} : {
    title: req.query.title || '',
    slug: req.query.slug || '',
    type: req.query.type || 'md',
    tags: req.query.tags || ''
  };
  res.render('editor', { site: SITE_TITLE, current: 'editor', prefill, quick });
});

app.get('/edit/:slug', (req, res) => {
  const note = loadActiveNotes().find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).render('404', { site: SITE_TITLE });
  res.render('editor', { note, site: SITE_TITLE, current: 'editor' });
});

app.get('/list', (req, res) => {
  let listNotes = loadActiveNotes();
  const filterNb = req.query.nb || '';
  const notebooks = loadNotebooks().map(n => ({ name: typeof n === 'string' ? n : n.name, color: typeof n === 'string' ? '#4361ee' : (n.color || '#4361ee'), icon: typeof n === 'string' ? '📁' : (n.icon || '📁') }));
  if (filterNb) {
    listNotes = listNotes.filter(n => n.tags && n.tags.includes(filterNb));
  }
  listNotes.sort((a, b) => pinnedFirst(a, b) || a.title.localeCompare(b.title, 'zh'));
  res.render('list', { notes: listNotes, notebooks, currentNb: filterNb, site: SITE_TITLE, current: 'list' });
});

app.get('/gallery', (req, res) => {
  res.render('gallery', { images: listImages(), site: SITE_TITLE, current: 'gallery' });
});

app.get('/notebook/:name', (req, res) => {
  const name = req.params.name;
  const notes = loadActiveNotes().filter(n => n.tags && n.tags.includes(name));
  notes.sort((a, b) => pinnedFirst(a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));
  res.render('notebook', { notes, notebook: name, site: SITE_TITLE, current: 'notebook', nbColor: getNotebookColor(name), nbIcon: getNotebookIcon(name) });
});


// Notebooks overview page
app.get('/notebooks', (req, res) => {
  const notebooks = loadNotebooks().map(n => ({
    name: typeof n === 'string' ? n : n.name,
    color: typeof n === 'string' ? '#4361ee' : (n.color || '#4361ee'),
    icon: typeof n === 'string' ? '📁' : (n.icon || '📁'),
    count: loadActiveNotes().filter(x => x.tags && x.tags.includes(typeof n === 'string' ? n : n.name)).length
  }));
  res.render('notebooks', { notebooks, site: SITE_TITLE, current: 'notebooks' });
});
// Create / update note from form
app.post('/api/notes', (req, res) => {
  const { title, slug, content, type, tags } = req.body;
  if (!title || !slug || !content) return res.status(400).json({ error: '标题、网址和内容不能为空' });
  if (!validSlug(slug)) return res.status(400).json({ error: '网址格式不合法' });

  const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const notes = loadActiveNotes();
  const existing = notes.find(n => n.slug === slug);
  const now = new Date().toISOString();
  if (existing) {
    existing.title = title;
    existing.content = content;
    existing.type = type || 'md';
    existing.tags = parsedTags;
    existing.updatedAt = now;
  } else {
    notes.push({ id: crypto.randomBytes(8).toString('hex'), slug, title, content, type: type || 'md', tags: parsedTags, imgSizes: req.body.imgSizes || {}, createdAt: now, updatedAt: now });
  }
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true, slug });
});

// Upload file as note
app.post('/api/upload-file', fileUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const name = path.basename(req.file.originalname, ext);
  const slug = req.body.slug || name.replace(/[^\w一-鿿]/g, '-').replace(/-+/g, '-');
  const title = req.body.title || name;
  const type = LANG_MAP[ext] || 'txt';

  const done = (content) => {
    const notes = loadActiveNotes();
    const existing = notes.find(n => n.slug === slug);
    const now = new Date().toISOString();
    if (existing) {
      existing.title = title; existing.content = content; existing.type = type; existing.updatedAt = now;
    } else {
      notes.push({ id: crypto.randomBytes(8).toString('hex'), slug, title, content, type, createdAt: now, updatedAt: now });
    }
    saveNotes(notes);
    debouncedGitSync();
    res.json({ ok: true, slug, title });
  };

  if (ext === '.docx') {
    mammoth.extractRawText({ buffer: req.file.buffer })
      .then(result => done(result.value))
      .catch(() => done(''));
  } else {
    done(req.file.buffer.toString('utf-8'));
  }
});

// Parse .docx file for editor insertion
const docxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/parse-docx', docxUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  mammoth.extractRawText({ buffer: req.file.buffer })
    .then(result => res.json({ ok: true, text: result.value }))
    .catch(() => res.status(500).json({ error: '无法解析 .docx 文件' }));
});
app.post('/api/upload-image', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  const url = '/img/' + req.file.filename;
  debouncedGitSync();
  res.json({ ok: true, url, md: '![' + (req.body.alt || 'image') + '](' + url + ')' });
});

// Multi image upload
app.post('/api/upload-images', imageUpload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请选择图片' });
  debouncedGitSync();
  res.json({ ok: true, count: req.files.length });
});

// List images
app.get('/api/images', (req, res) => {
  res.json(listImages());
});

// Git sync status
app.get('/api/git-status', (req, res) => {
  res.json({ ...gitState, tokenSet: !!GIT_TOKEN });
});

// Delete image (checks note references unless ?force=1)
app.delete('/api/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'not found' });
  const refs = loadActiveNotes()
    .filter(n => n.content && n.content.includes('/img/' + filename))
    .map(n => ({ slug: n.slug, title: n.title }));
  if (refs.length > 0 && req.query.force !== '1') {
    return res.json({ ok: false, referenced: refs });
  }
  fs.unlinkSync(filepath);
  debouncedGitSync();
  res.json({ ok: true });
});

// ---- Trash / Soft delete ----

// Soft delete: move note to trash
app.delete('/api/notes/:slug', (req, res) => {
  const notes = loadNotes();
  const note = notes.find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).json({ error: 'not found' });
  note.deletedAt = new Date().toISOString();
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true, slug: req.params.slug });
});

// Toggle pin (置顶)
app.post('/api/notes/:slug/pin', (req, res) => {
  const notes = loadNotes();
  const note = notes.find(n => n.slug === req.params.slug && !n.deletedAt);
  if (!note) return res.status(404).json({ error: 'not found' });
  note.pinned = !note.pinned;
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true, pinned: note.pinned });
});

// List trash
app.get('/api/trash', (req, res) => {
  const notes = loadNotes().filter(n => n.deletedAt)
    .map(n => ({ slug: n.slug, title: n.title, type: n.type, deletedAt: n.deletedAt }));
  notes.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.json(notes);
});

// Restore from trash
app.post('/api/notes/:slug/restore', (req, res) => {
  const notes = loadNotes();
  const note = notes.find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).json({ error: 'not found' });
  delete note.deletedAt;
  note.updatedAt = new Date().toISOString();
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true, slug: req.params.slug });
});

// Permanently delete
app.delete('/api/trash/:slug', (req, res) => {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  notes.splice(idx, 1);
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true });
});

// Empty trash
app.delete('/api/trash', (req, res) => {
  let notes = loadNotes();
  notes = notes.filter(n => !n.deletedAt);
  saveNotes(notes);
  debouncedGitSync();
  res.json({ ok: true });
});

// JSON API
app.get('/api/notes', (req, res) => {
  const notes = loadActiveNotes().map(n => ({ slug: n.slug, title: n.title, type: n.type, tags: n.tags || [], pinned: !!n.pinned, updatedAt: n.updatedAt, createdAt: n.createdAt }));
  notes.sort((a, b) => pinnedFirst(a, b) || new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(notes);
});

// Trash page
app.get('/trash', (req, res) => {
  const notes = loadNotes().filter(n => n.deletedAt);
  notes.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.render('trash', { notes, site: SITE_TITLE, current: 'trash', nbColor: '', nbIcon: '' });
});

// Notebook APIs
app.get('/api/notebooks', (req, res) => {
  const notebooks = loadNotebooks();
  const notes = loadActiveNotes();
  // Return notebooks with note counts and metadata
  const result = notebooks.map(nb => {
    const name = typeof nb === 'string' ? nb : nb.name;
    return {
      name,
      color: typeof nb === 'string' ? '#4361ee' : (nb.color || '#4361ee'),
      icon: typeof nb === 'string' ? '📁' : (nb.icon || '📁'),
      count: notes.filter(n => n.tags && n.tags.includes(name)).length
    };
  });
  res.json(result);
});

app.post('/api/notebooks', (req, res) => {
  const { name, notes: noteSlugs } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  const notebooks = loadNotebooks();
  if (notebooks.includes(name.trim())) return res.status(400).json({ error: '笔记本已存在' });
  notebooks.push(name.trim());
  saveNotebooks(notebooks);
  // Add tag to selected notes
  if (noteSlugs && noteSlugs.length) {
    const allNotes = loadActiveNotes();
    noteSlugs.forEach(slug => {
      const n = allNotes.find(x => x.slug === slug);
      if (n) {
        if (!n.tags) n.tags = [];
        if (!n.tags.includes(name.trim())) n.tags.push(name.trim());
      }
    });
    saveNotes(allNotes);
    debouncedGitSync();
  }
  res.json({ ok: true, name: name.trim() });
});

// Auto-name for new notes/notebooks
app.get('/api/next-name', (req, res) => {
  const type = req.query.type || 'note';
  if (type === 'notebook') {
    const notebooks = loadNotebooks();
    let num = 1;
    while (getNotebookNames().includes('新建笔记本' + num)) num++;
    res.json({ name: '新建笔记本' + num });
  } else {
    const notes = loadActiveNotes();
    let num = 1;
    while (notes.some(n => n.title === String(num) || n.slug === String(num))) num++;
    res.json({ name: String(num) });
  }
});

app.put('/api/notebooks/:name', (req, res) => {
  const { newName, addNotes } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: '名称不能为空' });
  const notebooks = loadNotebooks();
  const idx = notebooks.findIndex(n => (typeof n === 'string' ? n : n.name) === req.params.name);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  if (notebooks.includes(newName.trim()) && newName.trim() !== req.params.name) {
    return res.status(400).json({ error: '笔记本已存在' });
  }
  const notes = loadNotes();
  // Rename tag in all notes
  notes.forEach(n => {
    if (n.tags && n.tags.includes(req.params.name)) {
      n.tags = n.tags.map(t => t === req.params.name ? newName.trim() : t);
    }
  });
  // Add selected notes to notebook
  if (addNotes && addNotes.length) {
    addNotes.forEach(slug => {
      const n = notes.find(x => x.slug === slug);
      if (n) {
        if (!n.tags) n.tags = [];
        if (!n.tags.includes(newName.trim())) n.tags.push(newName.trim());
      }
    });
  }
  saveNotes(notes);
  const oldNb = notebooks[idx];
  notebooks[idx] = typeof oldNb === 'string' ? newName.trim() : { ...oldNb, name: newName.trim() };
  saveNotebooks(notebooks);
  debouncedGitSync();
  res.json({ ok: true, name: newName.trim() });
});

app.delete('/api/notebooks/:name', (req, res) => {
  const action = req.query.action || 'delete';
  const notebooks = loadNotebooks();
  const idx = notebooks.indexOf(req.params.name);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  if (action === 'untag') {
    // Remove this tag from all notes (move notes out of notebook)
    const notes = loadNotes();
    notes.forEach(n => {
      if (n.tags) {
        n.tags = n.tags.filter(t => t !== req.params.name);
      }
    });
    saveNotes(notes);
  }
  // Delete the notebook
  notebooks.splice(idx, 1);
  saveNotebooks(notebooks);
  res.json({ ok: true });
});

// Render markdown preview
app.post('/api/render', (req, res) => {
  const { content, type } = req.body;
  if (!content) return res.json({ html: '' });
  try {
    const html = renderContent({ content, type: type || 'md' });
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: '渲染失败' });
  }
});

// 404
app.use((req, res) => res.status(404).render('404', { site: SITE_TITLE, current: '404' }));


// ---- Backup & Restore ----
app.get("/api/backup", (req, res) => {
  const backup = {
    version: "1.0",
    date: new Date().toISOString(),
    notes: loadNotes(),
    notebooks: loadNotebooks()
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=mynote-backup-" + new Date().toISOString().slice(0,10) + ".json");
  res.json(backup);
});

app.post("/api/restore", express.json({limit:"50mb"}), (req, res) => {
  const data = req.body;
  if (!data || !data.version) return res.status(400).json({error: "无效的备份文件"});
  if (data.notes) {
    saveNotes(data.notes);
    notesCache = data.notes;
  }
  if (data.notebooks) {
    saveNotebooks(data.notebooks);
    notebooksCache = data.notebooks;
  }
  res.json({ok: true, notesCount: data.notes ? data.notes.length : 0});
});

// ---- Start ----
const os = require('os');
const IS_ELECTRON = process.env.ELECTRON_RUN || false;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '0.0.0.0';
}

let serverInstance = null;
let serverPort = PORT;

function startServer() {
  return new Promise((resolve, reject) => {
    const attempt = (port) => {
      const srv = app.listen(port, '0.0.0.0');
      srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port === PORT) {
          console.log(`端口 ${PORT} 被占用，自动改用空闲端口`);
          attempt(0); // let OS pick a free port
        } else {
          reject(err);
        }
      });
      srv.once('listening', () => {
        serverPort = srv.address().port;
        serverInstance = srv;
        const localIP = getLocalIP();
        console.log(`Notes site 本地: http://localhost:${serverPort}`);
        console.log(`局域网访问:   http://${localIP}:${serverPort}`);
        resolve(srv);
      });
    };
    attempt(PORT);
  });
}

function getPort() { return serverPort; }

// 直接运行（网页模式）时自动启动，Electron 模式下由 Electron 调用 startServer
if (!IS_ELECTRON) {
  (async () => {
    await startServer();
  })();
}

module.exports = { app, startServer, getPort };
