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

// Card delete
async function delNoteCard(btn, slug) {
  if (!confirm('确定删除笔记 "' + slug + '" 吗？此操作不可恢复。')) return;
  try {
    const res = await fetch('/api/notes/' + encodeURIComponent(slug), { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      const card = btn.closest('[data-slug]');
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        card.style.transition = 'all .2s';
        setTimeout(() => card.remove(), 200);
      }
    } else {
      alert('删除失败：' + data.error);
    }
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}
