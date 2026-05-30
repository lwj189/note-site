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

// New notebook
function showNewNotebook() {
  var name = prompt('输入新笔记本名称：');
  if (!name || !name.trim()) return;
  fetch('/api/notebooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) window.location.reload();
    else alert(data.error);
  }).catch(function(err) { alert('创建失败：' + err.message); });
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
  if (!confirm('确定删除笔记 "' + slug + '" 吗？此操作不可恢复。')) return;
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
