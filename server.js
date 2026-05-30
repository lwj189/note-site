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
function loadNotes() {
  try {
    if (!fs.existsSync(NOTES_FILE)) return [];
    return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
  } catch { return []; }
}

function saveNotes(notes) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

function loadNotebooks() {
  try {
    if (!fs.existsSync(NOTEBOOKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(NOTEBOOKS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveNotebooks(notebooks) {
  fs.writeFileSync(NOTEBOOKS_FILE, JSON.stringify(notebooks, null, 2));
}

function highlightKeyword(text, keyword) {
  if (!keyword || !text) return esc(text);
  const escaped = esc(text);
  const kw = esc(keyword).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return escaped.replace(new RegExp('(' + kw + ')', 'gi'), '<mark>$1</mark>');
}

// ---- Git auto-sync ----
const { exec } = require('child_process');

function gitSync(callback) {
  if (!GIT_TOKEN) {
    console.log('[git] GIT_TOKEN not set, skip auto-sync');
    if (callback) callback();
    return;
  }
  const remote = `https://${GIT_TOKEN}@${GIT_REPO}`;
  const cmds = [
    'git add data/',
    `git -c user.name="${GIT_USER}" -c user.email="${GIT_USER}@users.noreply.github.com" commit -m "auto: update notes"`,
    `git push ${remote} main`
  ];
  const run = (i) => {
    if (i >= cmds.length) {
      console.log('[git] sync done');
      if (callback) callback();
      return;
    }
    exec(cmds[i], { cwd: __dirname, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && i === 0 && err.message.includes('nothing to commit')) {
        console.log('[git] nothing to commit, skip');
        if (callback) callback();
        return;
      }
      if (err && i === 0 && err.message.includes('nothing added to commit')) {
        console.log('[git] nothing to commit, skip');
        if (callback) callback();
        return;
      }
      if (err) {
        console.error(`[git] error: ${stderr || err.message}`);
        if (callback) callback(err);
        return;
      }
      run(i + 1);
    });
  };
  run(0);
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
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'];
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
  if (note.type === 'md') return marked.parse(note.content);
  if (note.type === 'txt') return '<pre class="plain">' + esc(note.content) + '</pre>';
  return marked.parse('```' + note.type + '\n' + note.content + '\n```');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validSlug(s) {
  return /^[\w一-鿿\-\+]+$/.test(s);
}

function listImages() {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'];
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

// ---- Public routes ----

app.get('/', (req, res) => {
  const editSlug = req.query.edit || '';
  const notes = loadNotes();
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const editNote = editSlug ? notes.find(n => n.slug === editSlug) : null;
  res.render('home', { notes, site: SITE_TITLE, current: 'home', query: '', editNote });
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const timeFilter = req.query.time || '';
  const dateFrom = req.query.from || '';
  const dateTo = req.query.to || '';
  let notes = loadNotes();

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

  titleMatches.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  contentMatches.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  res.render('search', {
    notes, site: SITE_TITLE, current: 'search', query: q,
    titleMatches, contentMatches, timeFilter, dateFrom, dateTo,
    highlightKeyword
  });
});

app.get('/note/:slug', (req, res) => {
  const note = loadNotes().find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).render('404', { site: SITE_TITLE });
  res.render('note', { note, html: renderContent(note), site: SITE_TITLE, current: 'note' });
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
  const note = loadNotes().find(n => n.slug === req.params.slug);
  if (!note) return res.status(404).render('404', { site: SITE_TITLE });
  res.render('editor', { note, site: SITE_TITLE, current: 'editor' });
});

app.get('/list', (req, res) => {
  const notes = loadNotes();
  notes.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  res.render('list', { notes, site: SITE_TITLE, current: 'list' });
});

app.get('/gallery', (req, res) => {
  res.render('gallery', { images: listImages(), site: SITE_TITLE, current: 'gallery' });
});

app.get('/notebook/:name', (req, res) => {
  const name = req.params.name;
  const notes = loadNotes().filter(n => n.tags && n.tags.includes(name));
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.render('notebook', { notes, notebook: name, site: SITE_TITLE, current: 'notebook' });
});

// Create / update note from form
app.post('/api/notes', (req, res) => {
  const { title, slug, content, type, tags } = req.body;
  if (!title || !slug || !content) return res.status(400).json({ error: '标题、网址和内容不能为空' });
  if (!validSlug(slug)) return res.status(400).json({ error: '网址格式不合法' });

  const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const notes = loadNotes();
  const existing = notes.find(n => n.slug === slug);
  const now = new Date().toISOString();
  if (existing) {
    existing.title = title;
    existing.content = content;
    existing.type = type || 'md';
    existing.tags = parsedTags;
    existing.updatedAt = now;
  } else {
    notes.push({ id: crypto.randomBytes(8).toString('hex'), slug, title, content, type: type || 'md', tags: parsedTags, createdAt: now, updatedAt: now });
  }
  saveNotes(notes);
  gitSync();
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
    const notes = loadNotes();
    const existing = notes.find(n => n.slug === slug);
    const now = new Date().toISOString();
    if (existing) {
      existing.title = title; existing.content = content; existing.type = type; existing.updatedAt = now;
    } else {
      notes.push({ id: crypto.randomBytes(8).toString('hex'), slug, title, content, type, createdAt: now, updatedAt: now });
    }
    saveNotes(notes);
    gitSync();
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
  gitSync();
  res.json({ ok: true, url, md: '![' + (req.body.alt || 'image') + '](' + url + ')' });
});

// Multi image upload
app.post('/api/upload-images', imageUpload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请选择图片' });
  gitSync();
  res.json({ ok: true, count: req.files.length });
});

// List images
app.get('/api/images', (req, res) => {
  res.json(listImages());
});

// Delete image
app.delete('/api/images/:filename', (req, res) => {
  const filepath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(filepath);
  gitSync();
  res.json({ ok: true });
});

// Delete note
app.delete('/api/notes/:slug', (req, res) => {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  notes.splice(idx, 1);
  saveNotes(notes);
  gitSync();
  res.json({ ok: true });
});

// JSON API
app.get('/api/notes', (req, res) => {
  res.json(loadNotes().map(n => ({ slug: n.slug, title: n.title, type: n.type, tags: n.tags || [], updatedAt: n.updatedAt })));
});

// Notebook APIs
app.get('/api/notebooks', (req, res) => {
  const notebooks = loadNotebooks();
  const notes = loadNotes();
  // Return notebooks with note counts
  const result = notebooks.map(name => ({
    name,
    count: notes.filter(n => n.tags && n.tags.includes(name)).length
  }));
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
    const allNotes = loadNotes();
    noteSlugs.forEach(slug => {
      const n = allNotes.find(x => x.slug === slug);
      if (n) {
        if (!n.tags) n.tags = [];
        if (!n.tags.includes(name.trim())) n.tags.push(name.trim());
      }
    });
    saveNotes(allNotes);
    gitSync();
  }
  res.json({ ok: true, name: name.trim() });
});

// Auto-name for new notes/notebooks
app.get('/api/next-name', (req, res) => {
  const type = req.query.type || 'note';
  if (type === 'notebook') {
    const notebooks = loadNotebooks();
    let num = 1;
    while (notebooks.includes('新建笔记本' + num)) num++;
    res.json({ name: '新建笔记本' + num });
  } else {
    const notes = loadNotes();
    let num = 1;
    while (notes.some(n => n.title === '新建笔记' + num)) num++;
    res.json({ name: '新建笔记' + num });
  }
});

app.put('/api/notebooks/:name', (req, res) => {
  const { newName, addNotes } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: '名称不能为空' });
  const notebooks = loadNotebooks();
  const idx = notebooks.indexOf(req.params.name);
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
  notebooks[idx] = newName.trim();
  saveNotebooks(notebooks);
  gitSync();
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

// ---- Start ----
app.listen(PORT, () => {
  console.log(`Notes site: http://localhost:${PORT}`);
});
