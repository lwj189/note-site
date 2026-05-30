// Sidebar: load recent notes
(async function() {
  const list = document.getElementById('sidebar-recent-list');
  if (!list) return;

  try {
    const res = await fetch('/api/notes');
    const notes = await res.json();
    if (!notes.length) {
      list.innerHTML = '<div class="sidebar-recent-loading">暂无笔记</div>';
      return;
    }
    // Sort by updatedAt descending, take first 8
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const recent = notes.slice(0, 8);
    list.innerHTML = recent.map(n =>
      '<a href="/note/' + encodeURIComponent(n.slug) + '" class="sidebar-recent-item" title="' +
      n.title.replace(/"/g, '&quot;') + '">' +
      n.title.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</a>'
    ).join('');
  } catch (err) {
    list.innerHTML = '<div class="sidebar-recent-loading">加载失败</div>';
  }
})();
