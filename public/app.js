// Settings
const SETTINGS_KEY = 'mynote_settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function applySettings() {
  var s = loadSettings();
  // Theme
  if (s.theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
  // Font size
  var fs = s.fontSize || 'm';
  document.documentElement.style.setProperty('--font-scale', fs === 's' ? '0.9' : fs === 'l' ? '1.15' : '1');
  // Not needed for Git/sort since those are server-side or implicit
}
applySettings();

// Settings modal
function openSettings() {
  var s = loadSettings();
  var html = '<div class="settings-overlay" onclick="closeSettings(event)"><div class="settings-dialog" onclick="event.stopPropagation()">' +
    '<div class="settings-header"><span class="settings-title">设置</span><button class="picker-close" onclick="closeSettings()">&times;</button></div>' +
    '<div class="settings-body">' +
      '<div class="settings-row"><label>主题模式</label><select id="set-theme"><option value="light"' + (s.theme !== 'dark' ? ' selected' : '') + '>浅色</option><option value="dark"' + (s.theme === 'dark' ? ' selected' : '') + '>深色</option></select></div>' +
      '<div class="settings-row"><label>字体大小</label><select id="set-font"><option value="s"' + (s.fontSize === 's' ? ' selected' : '') + '>小</option><option value="m"' + ((s.fontSize || 'm') === 'm' ? ' selected' : '') + '>中</option><option value="l"' + (s.fontSize === 'l' ? ' selected' : '') + '>大</option></select></div>' +
      '<div class="settings-row"><label>Git 自动同步</label><select id="set-git"><option value="on"' + (s.gitSync !== 'off' ? ' selected' : '') + '>开启</option><option value="off"' + (s.gitSync === 'off' ? ' selected' : '') + '>关闭</option></select></div>' +
      '<div class="settings-row"><label>首页排序</label><select id="set-sort"><option value="updated"' + ((s.sort || 'updated') === 'updated' ? ' selected' : '') + '>按更新时间</option><option value="created"' + (s.sort === 'created' ? ' selected' : '') + '>按创建时间</option><option value="alpha"' + (s.sort === 'alpha' ? ' selected' : '') + '>按字母顺序</option></select></div>' +
    '</div>' +
    '<div class="settings-footer"><button class="btn" onclick="saveAndCloseSettings()">保存设置</button></div>' +
  '</div></div>';
  var div = document.createElement('div');
  div.id = 'settings-container';
  div.innerHTML = html;
  document.body.appendChild(div);
}
function closeSettings(e) {
  if (e && e.target !== document.querySelector('.settings-overlay')) return;
  var el = document.getElementById('settings-container');
  if (el) el.remove();
}
function saveAndCloseSettings() {
  var s = loadSettings();
  s.theme = document.getElementById('set-theme').value;
  s.fontSize = document.getElementById('set-font').value;
  s.gitSync = document.getElementById('set-git').value;
  s.sort = document.getElementById('set-sort').value;
  saveSettings(s);
  applySettings();
  closeSettings();
}

// Sidebar: load recent notes
(async function() {
  var list = document.getElementById('sidebar-recent-list');
  if (!list) return;
  try {
    var res = await fetch('/api/notes');
    var notes = await res.json();
    if (!notes.length) { list.innerHTML = '<div class="sidebar-recent-loading">暂无笔记</div>'; return; }
    var s = loadSettings();
    if (s.sort === 'created') notes.sort((a,b) => new Date(b.createdAt||b.updatedAt) - new Date(a.createdAt||a.updatedAt));
    else if (s.sort === 'alpha') notes.sort((a,b) => a.title.localeCompare(b.title, 'zh'));
    else notes.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    var recent = notes.slice(0, 8);
    list.innerHTML = recent.map(function(n) {
      return '<a href="/note/' + encodeURIComponent(n.slug) + '" class="sidebar-recent-item" title="' +
        n.title.replace(/"/g, '&quot;') + '">' +
        n.title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</a>';
    }).join('');
  } catch (err) { list.innerHTML = '<div class="sidebar-recent-loading">加载失败</div>'; }
})();

// Sidebar: load notebooks
(async function() {
  var list = document.getElementById('sidebar-notebook-list');
  if (!list) return;
  try {
    var res = await fetch('/api/notebooks');
    var notebooks = await res.json();
    if (!notebooks.length) { list.innerHTML = '<div class="sidebar-recent-loading">暂无笔记本，点击 + 创建</div>'; return; }
    list.innerHTML = notebooks.map(function(nb) {
      return '<div class="sidebar-notebook-row" data-name="' + nb.name.replace(/"/g, '&quot;') + '">' +
        '<a href="/notebook/' + encodeURIComponent(nb.name) + '" class="sidebar-notebook-item">' +
          '<span class="notebook-name">' + nb.name.replace(/</g, '&lt;') + '</span>' +
          '<span class="notebook-count">' + nb.count + '</span>' +
        '</a>' +
        '<div class="notebook-actions">' +
          '<button class="nb-action-btn nb-edit-btn" title="重命名" onclick="event.stopPropagation();event.preventDefault();renameNotebook(\'' + nb.name.replace(/'/g, "\\'") + '\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
          '<button class="nb-action-btn nb-del-btn" title="删除" onclick="event.stopPropagation();event.preventDefault();deleteNotebook(\'' + nb.name.replace(/'/g, "\\'") + '\', ' + nb.count + ')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (err) { list.innerHTML = '<div class="sidebar-recent-loading">加载失败</div>'; }
})();

// ---- New Note Modal ----
function showNewNote() {
  fetch('/api/next-name?type=note').then(function(r) { return r.json(); }).then(function(d) {
    var html = '<div class="settings-overlay" onclick="closeModal(event,\'new-note-modal\')"><div class="settings-dialog" onclick="event.stopPropagation()">' +
      '<div class="settings-header"><span class="settings-title">新建笔记</span><button class="picker-close" onclick="closeModal(null,\'new-note-modal\')">&times;</button></div>' +
      '<div class="settings-body">' +
        '<div class="modal-field"><label>标题</label><input type="text" id="nn-title" placeholder="笔记标题"></div>' +
        '<div class="modal-field"><label>网址路径</label><input type="text" id="nn-slug" placeholder="自动生成"></div>' +
        '<div class="modal-field"><label>类型</label><select id="nn-type"><option value="md">Markdown</option><option value="txt">纯文本</option></select></div>' +
        '<div class="modal-field"><label>标签</label><input type="text" id="nn-tags" placeholder="如: 工作, 待整理"></div>' +
      '</div>' +
      '<div class="settings-footer" style="display:flex;gap:10px;justify-content:space-between">' +
        '<button class="btn btn-outline btn-sm" style="margin-top:0" onclick="quickCreateNote()">先写内容</button>' +
        '<button class="btn btn-sm" style="margin-top:0" onclick="submitNewNote()">创建并编辑</button>' +
      '</div>' +
    '</div></div>';
    var div = document.createElement('div'); div.id = 'new-note-modal'; div.innerHTML = html;
    document.body.appendChild(div);
    // Auto-fill suggestion
    document.getElementById('nn-title').placeholder = '如: ' + d.name;
    document.getElementById('nn-title').addEventListener('input', function() {
      var slug = document.getElementById('nn-slug');
      if (!slug.dataset.touched) {
        slug.value = this.value.replace(/[^\w一-鿿]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || d.name.replace(/[^\w]/g, '-');
      }
    });
    document.getElementById('nn-slug').addEventListener('input', function() { this.dataset.touched = '1'; });
  });
}

function submitNewNote() {
  var title = document.getElementById('nn-title').value.trim();
  var slug = document.getElementById('nn-slug').value.trim();
  var type = document.getElementById('nn-type').value;
  var tags = document.getElementById('nn-tags').value.trim();
  if (!title) { alert('请输入标题'); return; }
  if (!slug) { alert('请输入网址路径'); return; }
  var qs = '?title=' + encodeURIComponent(title) + '&slug=' + encodeURIComponent(slug) + '&type=' + type;
  if (tags) qs += '&tags=' + encodeURIComponent(tags);
  window.location.href = '/new' + qs;
}

function quickCreateNote() {
  window.location.href = '/new?quick=1';
}

function closeModal(e, id) {
  if (e && e.target !== document.querySelector('.settings-overlay')) return;
  var el = document.getElementById(id);
  if (el) el.remove();
}

// ---- New Notebook Modal ----
function showNewNotebook() {
  fetch('/api/next-name?type=notebook').then(function(r) { return r.json(); }).then(function(d) {
    fetch('/api/notes').then(function(r2) { return r2.json(); }).then(function(notes) {
      var noteList = '';
      if (notes.length) {
        noteList = '<div class="modal-field"><label>添加已有笔记（可选）</label><div class="modal-check-list">' +
          notes.sort(function(a,b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }).slice(0, 15).map(function(n) {
            return '<label class="modal-check-item"><input type="checkbox" value="' + n.slug + '"> ' + n.title.replace(/</g,'&lt;') + '</label>';
          }).join('') + '</div></div>';
      }
      var html = '<div class="settings-overlay" onclick="closeModal(event,\'new-nb-modal\')"><div class="settings-dialog" onclick="event.stopPropagation()">' +
        '<div class="settings-header"><span class="settings-title">新建笔记本</span><button class="picker-close" onclick="closeModal(null,\'new-nb-modal\')">&times;</button></div>' +
        '<div class="settings-body">' +
          '<div class="modal-field"><label>笔记本名称</label><input type="text" id="nnb-name" placeholder="如: ' + d.name + '"></div>' +
          noteList +
        '</div>' +
        '<div class="settings-footer" style="display:flex;gap:10px;justify-content:space-between">' +
          '<button class="btn btn-outline btn-sm" style="margin-top:0" onclick="quickCreateNotebook(\'' + d.name + '\')">直接创建</button>' +
          '<button class="btn btn-sm" style="margin-top:0" onclick="submitNewNotebook()">创建</button>' +
        '</div>' +
      '</div></div>';
      var div = document.createElement('div'); div.id = 'new-nb-modal'; div.innerHTML = html;
      document.body.appendChild(div);
    });
  });
}

function submitNewNotebook() {
  var name = document.getElementById('nnb-name').value.trim();
  if (!name) { alert('请输入笔记本名称'); return; }
  // Get selected notes
  var slugs = [];
  document.querySelectorAll('#new-nb-modal .modal-check-item input:checked').forEach(function(cb) { slugs.push(cb.value); });
  fetch('/api/notebooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, notes: slugs })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) window.location.reload();
    else alert(data.error);
  }).catch(function(err) { alert('创建失败：' + err.message); });
}

function quickCreateNotebook(autoName) {
  fetch('/api/notebooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: autoName })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) window.location.reload();
    else alert(data.error);
  });
}

// Rename notebook
function renameNotebook(oldName) {
  var newName = prompt('重命名笔记本 "' + oldName + '" 为：', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  fetch('/api/notebooks/' + encodeURIComponent(oldName), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName: newName.trim() })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) window.location.reload();
    else alert(data.error);
  }).catch(function(err) { alert('重命名失败：' + err.message); });
}

// Delete notebook
function deleteNotebook(name, count) {
  var msg = '确定删除笔记本 "' + name + '" 吗？';
  if (count > 0) msg += '\n\n笔记本内有 ' + count + ' 篇笔记。';
  msg += '\n\n选择操作：';
  var action;
  if (count > 0) {
    action = prompt(msg + '\n输入 1：同时移除笔记的 "' + name + '" 标签（将笔记移出笔记本）\n输入 2：仅删除笔记本，保留笔记标签\n输入其他：取消');
  } else {
    action = confirm(msg) ? '2' : null;
  }
  if (!action) return;
  var url = '/api/notebooks/' + encodeURIComponent(name);
  if (action === '1') url += '?action=untag';
  else if (action !== '2') return;
  fetch(url, { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) window.location.reload();
    else alert(data.error);
  }).catch(function(err) { alert('删除失败：' + err.message); });
}

// Card delete
async function delNoteCard(btn, slug) {
  if (!confirm('确定将笔记 "' + slug + '" 移到回收站？')) return;
  try {
    var res = await fetch('/api/notes/' + encodeURIComponent(slug), { method: 'DELETE' });
    var data = await res.json();
    if (data.ok) {
      var card = btn.closest('[data-slug]');
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        card.style.transition = 'all .2s';
        setTimeout(function() { card.remove(); }, 200);
      }
    } else { alert('删除失败：' + data.error); }
  } catch (err) { alert('删除失败：' + err.message); }
}

// ---- Sidebar live search ----
(function() {
  var input = document.getElementById('sidebar-search-input');
  var results = document.getElementById('sidebar-search-results');
  if (!input || !results) return;

  var notesCache = null;
  var debounceTimer = null;

  function loadNotesCache() {
    if (notesCache) return Promise.resolve(notesCache);
    return fetch('/api/notes').then(function(r) { return r.json(); }).then(function(data) {
      notesCache = data;
      return notesCache;
    });
  }

  function doSearch(query) {
    if (!query || query.length < 1) {
      results.style.display = 'none';
      return;
    }
    var q = query.toLowerCase().trim();
    loadNotesCache().then(function(notes) {
      var matches = notes.filter(function(n) {
        return n.title.toLowerCase().indexOf(q) !== -1 ||
               (n.slug && n.slug.toLowerCase().indexOf(q) !== -1);
      });
      matches.sort(function(a, b) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      matches = matches.slice(0, 8);

      if (matches.length === 0) {
        results.innerHTML = '<div class="search-result-empty">无匹配结果</div>';
      } else {
        var html = '';
        matches.forEach(function(n) {
          var title = n.title;
          var idx = title.toLowerCase().indexOf(q);
          if (idx !== -1) {
            title = title.substring(0, idx) + '<strong>' + title.substring(idx, idx + q.length) + '</strong>' + title.substring(idx + q.length);
          }
          html += '<a href="/note/' + encodeURIComponent(n.slug) + '" class="search-result-item">' +
            '<span class="search-result-title">' + title + '</span>' +
            '<span class="search-result-type badge">' + n.type + '</span>' +
            '</a>';
        });
        html += '<a href="/search?q=' + encodeURIComponent(query) + '" class="search-result-all">→ 查看全部结果</a>';
        results.innerHTML = html;
      }
      results.style.display = 'block';
    });
  }

  input.addEventListener('input', function() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { doSearch(input.value); }, 200);
  });

  input.addEventListener('focus', function() {
    if (input.value) doSearch(input.value);
  });

  // Close on click outside
  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });

  // Also refresh cache periodically
  setInterval(function() { notesCache = null; }, 60000);
})();
