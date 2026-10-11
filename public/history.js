// 版本历史：列表 + 与当前内容的行级差异（patience diff）+ 一键恢复
// 用法：openHistory(slug, { mode: 'view' | 'editor', currentContent: '...', onRestore: function(content){} })
(function () {
  'use strict';

  var state = { slug: null, mode: 'view', versions: [], selected: null, diff: [], cache: {}, onRestore: null, current: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString('zh-CN'); } catch (e) { return String(ts); }
  }
  function fmtSize(n) {
    if (!n && n !== 0) return '';
    return n >= 1024 ? (n / 1024).toFixed(n >= 102400 ? 0 : 1) + ' KB' : n + ' 字节';
  }
  function relTime(ts) {
    var d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    if (d < 86400000 * 30) return Math.floor(d / 86400000) + ' 天前';
    return fmtTime(ts).split(' ')[0];
  }
  function reasonLabel(r) {
    return { save: '保存前', upload: '导入前', restore: '恢复前' }[r] || (r || '历史版本');
  }

  // ---------- patience diff ----------
  function lisAnchors(pairs) {
    // pairs: [{bi, ai}]，按 ai 升序；对 bi 求最长递增子序列
    var tails = [], tailIdx = [], prev = new Array(pairs.length).fill(-1), i, lo, hi, mid;
    for (i = 0; i < pairs.length; i++) {
      var v = pairs[i].bi;
      lo = 0; hi = tails.length;
      while (lo < hi) { mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
      tails[lo] = v; tailIdx[lo] = i;
      prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    }
    var res = [], k = tails.length ? tailIdx[tails.length - 1] : -1;
    while (k >= 0) { res.push(pairs[k]); k = prev[k]; }
    return res.reverse();
  }
  function countLines(lines, from, to) {
    var m = new Map(), i;
    for (i = from; i < to; i++) m.set(lines[i], (m.get(lines[i]) || 0) + 1);
    return m;
  }
  function patienceAnchors(a, alo, ahi, b, blo, bhi) {
    var ca = countLines(a, alo, ahi), cb = countLines(b, blo, bhi);
    var posB = new Map(), i;
    for (i = blo; i < bhi; i++) if (cb.get(b[i]) === 1) posB.set(b[i], i);
    var pairs = [];
    for (i = alo; i < ahi; i++) {
      var c = ca.get(a[i]);
      if (c === 1 && posB.has(a[i])) pairs.push({ ai: i, bi: posB.get(a[i]) });
    }
    return pairs.length ? lisAnchors(pairs) : [];
  }
  function diffLines(aText, bText) {
    var a = String(aText == null ? '' : aText).split('\n');
    var b = String(bText == null ? '' : bText).split('\n');
    var out = [];
    function push(type, text) { out.push({ type: type, text: text }); }
    function rec(alo, ahi, blo, bhi) {
      while (alo < ahi && blo < bhi && a[alo] === b[blo]) { push('same', a[alo]); alo++; blo++; }
      var suffix = [];
      while (alo < ahi && blo < bhi && a[ahi - 1] === b[bhi - 1]) { suffix.push(a[ahi - 1]); ahi--; bhi--; }
      var i;
      if (alo >= ahi) {
        for (i = blo; i < bhi; i++) push('add', b[i]);
      } else if (blo >= bhi) {
        for (i = alo; i < ahi; i++) push('del', a[i]);
      } else {
        var anchors = patienceAnchors(a, alo, ahi, b, blo, bhi);
        if (!anchors.length) {
          for (i = alo; i < ahi; i++) push('del', a[i]);
          for (i = blo; i < bhi; i++) push('add', b[i]);
        } else {
          var pa = alo, pb = blo;
          anchors.forEach(function (an) {
            rec(pa, an.ai, pb, an.bi);
            push('same', a[an.ai]);
            pa = an.ai + 1; pb = an.bi + 1;
          });
          rec(pa, ahi, pb, bhi);
        }
      }
      for (i = suffix.length - 1; i >= 0; i--) push('same', suffix[i]);
    }
    rec(0, a.length, 0, b.length);
    return out;
  }

  // ---------- 渲染 ----------
  function renderDiff() {
    var box = document.getElementById('hist-diff-body');
    if (!box) return;
    var rows = state.diff, out = [], i = 0, add = 0, del = 0;
    // 相同行折叠：连续超过 8 行时只显示首尾各 3 行
    while (i < rows.length) {
      if (rows[i].type !== 'same') {
        if (rows[i].type === 'add') add++; else del++;
        out.push('<div class="hd-line hd-' + rows[i].type + '"><span class="hd-sign">' + (rows[i].type === 'add' ? '+' : '-') + '</span><span class="hd-text">' + (rows[i].text ? esc(rows[i].text) : '&nbsp;') + '</span></div>');
        i++;
        continue;
      }
      var j = i;
      while (j < rows.length && rows[j].type === 'same') j++;
      var n = j - i;
      if (n > 8) {
        for (var k = i; k < i + 3; k++) out.push(sameRow(rows[k].text));
        out.push('<div class="hd-fold" data-fold="' + (i + 3) + '-' + (j - 3) + '">⋯ 展开 ' + (n - 6) + ' 行相同内容</div>');
        for (var k2 = j - 3; k2 < j; k2++) out.push(sameRow(rows[k2].text));
      } else {
        for (var k3 = i; k3 < j; k3++) out.push(sameRow(rows[k3].text));
      }
      i = j;
    }
    function sameRow(t) { return '<div class="hd-line hd-same"><span class="hd-sign"></span><span class="hd-text">' + (t ? esc(t) : '&nbsp;') + '</span></div>'; }
    box.innerHTML = out.length ? out.join('') : '<div class="hd-empty">内容没有差异</div>';
    var stat = document.getElementById('hist-diff-stat');
    if (stat) stat.innerHTML = '<span class="hd-add-tag">+' + add + '</span><span class="hd-del-tag">-' + del + '</span>';
  }

  function renderList() {
    var box = document.getElementById('hist-list');
    if (!box) return;
    if (!state.versions.length) {
      box.innerHTML = '<div class="hd-empty">还没有历史版本。以后每次保存都会自动留一份旧稿。</div>';
      return;
    }
    box.innerHTML = state.versions.map(function (v) {
      return '<div class="hist-item' + (state.selected === v.id ? ' active' : '') + '" data-id="' + esc(v.id) + '" title="' + esc(fmtTime(v.ts)) + '">' +
        '<div class="hist-item-top"><span class="hist-reason">' + esc(reasonLabel(v.reason)) + '</span><span class="hist-time">' + esc(relTime(v.ts)) + '</span></div>' +
        '<div class="hist-item-mid">' + esc(fmtSize(v.size)) + ' · ' + (v.lines || 0) + ' 行</div>' +
        '<div class="hist-item-preview">' + esc((v.preview || '').slice(0, 60)) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderHead() {
    var t = document.getElementById('hist-title');
    if (t) t.textContent = '版本历史 · ' + (state.slug || '');
    var s = document.getElementById('hist-sub');
    if (s) s.textContent = state.versions.length ? ('共 ' + state.versions.length + ' 个历史版本（最多保留 30 个）') : '';
    var btn = document.getElementById('hist-restore-btn');
    if (btn) btn.disabled = !state.selected;
  }

  function selectVersion(id) {
    state.selected = id;
    renderList();
    renderHead();
    var body = document.getElementById('hist-diff-body');
    if (!id) { if (body) body.innerHTML = '<div class="hd-empty">选择左侧的一个版本查看与当前内容的差异</div>'; return; }
    if (state.cache[id]) {
      state.diff = diffLines(state.current, state.cache[id]);
      renderDiff();
      return;
    }
    if (body) body.innerHTML = '<div class="hd-empty">读取中…</div>';
    fetch('/api/notes/' + encodeURIComponent(state.slug) + '/history/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '读取失败');
        state.cache[id] = d.content || '';
        state.diff = diffLines(state.current, state.cache[id]);
        renderDiff();
      })
      .catch(function (e) { if (body) body.innerHTML = '<div class="hd-empty">读取失败：' + esc(e.message) + '</div>'; });
  }

  function restore() {
    if (!state.selected) return;
    var v = state.versions.filter(function (x) { return x.id === state.selected; })[0] || {};
    if (!confirm('用这个版本覆盖当前内容吗？\n\n版本时间：' + fmtTime(v.ts) + '\n' + (v.reason === 'restore' ? '（该版本本身是一次恢复操作前的快照）' : '') + '\n\n当前内容会先被自动存成一个新的历史版本，可以再回滚。')) return;
    var btn = document.getElementById('hist-restore-btn');
    if (btn) { btn.disabled = true; btn.textContent = '恢复中…'; }
    fetch('/api/notes/' + encodeURIComponent(state.slug) + '/history/' + encodeURIComponent(state.selected) + '/restore', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '恢复失败');
        if (state.mode === 'editor' && typeof state.onRestore === 'function') {
          state.onRestore(state.cache[state.selected] || '');
          closeHistory();
        } else {
          window.location.reload();
        }
      })
      .catch(function (e) {
        alert('恢复失败：' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '恢复此版本'; }
      });
  }

  window.openHistory = function (slug, opts) {
    opts = opts || {};
    state.slug = slug;
    state.mode = opts.mode || 'view';
    state.onRestore = opts.onRestore || null;
    state.current = typeof opts.currentContent === 'string' ? opts.currentContent : '';
    state.selected = null;
    state.versions = [];
    state.diff = [];
    state.cache = {};

    var old = document.getElementById('history-modal');
    if (old) old.remove();
    var html = '<div class="settings-overlay hist-overlay" onclick="closeHistory(event)">' +
      '<div class="settings-dialog hist-dialog" onclick="event.stopPropagation()">' +
        '<div class="settings-header"><span class="settings-title" id="hist-title">版本历史</span>' +
        '<button class="picker-close" onclick="closeHistory()">&times;</button></div>' +
        '<div class="hist-sub" id="hist-sub"></div>' +
        '<div class="hist-body">' +
          '<div class="hist-list" id="hist-list"><div class="hd-empty">读取中…</div></div>' +
          '<div class="hist-diff">' +
            '<div class="hist-diff-head"><span>与当前内容的差异</span><span id="hist-diff-stat"></span>' +
            '<span class="hist-legend"><i class="hd-dot hd-dot-add"></i>恢复后新增 <i class="hd-dot hd-dot-del"></i>恢复后删除</span></div>' +
            '<div class="hist-diff-body" id="hist-diff-body"><div class="hd-empty">选择左侧的一个版本查看差异</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="settings-footer"><button class="btn btn-ghost" onclick="closeHistory()">关闭</button>' +
        '<button class="btn" id="hist-restore-btn" onclick="restoreHistoryVersion()" disabled>恢复此版本</button></div>' +
      '</div></div>';
    var div = document.createElement('div');
    div.id = 'history-modal';
    div.innerHTML = html;
    document.body.appendChild(div);

    document.getElementById('hist-list').addEventListener('click', function (e) {
      var it = e.target.closest ? e.target.closest('.hist-item') : null;
      if (it) selectVersion(it.getAttribute('data-id'));
    });
    document.getElementById('hist-diff-body').addEventListener('click', function (e) {
      var fold = e.target.closest ? e.target.closest('.hd-fold') : null;
      if (!fold) return;
      var parts = fold.getAttribute('data-fold').split('-');
      var from = parseInt(parts[0], 10), to = parseInt(parts[1], 10), html = [];
      for (var k = from; k < to; k++) html.push('<div class="hd-line hd-same"><span class="hd-sign"></span><span class="hd-text">' + (state.diff[k].text ? esc(state.diff[k].text) : '&nbsp;') + '</span></div>');
      fold.outerHTML = html.join('');
    });

    fetch('/api/notes/' + encodeURIComponent(slug) + '/history')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '读取失败');
        state.versions = d.versions || [];
        renderList();
        renderHead();
        if (state.versions.length) selectVersion(state.versions[0].id);
      })
      .catch(function (e) {
        var box = document.getElementById('hist-list');
        if (box) box.innerHTML = '<div class="hd-empty">读取失败：' + esc(e.message) + '</div>';
      });
  };

  window.closeHistory = function (e) {
    if (e && e.target && !e.target.classList.contains('hist-overlay')) return;
    var el = document.getElementById('history-modal');
    if (el) el.remove();
  };
  window.restoreHistoryVersion = restore;

  function onKey(e) {
    if (e.key === 'Escape' && document.getElementById('history-modal')) window.closeHistory();
  }
  document.addEventListener('keydown', onKey);

  // 供测试使用
  window.__historyDiff = diffLines;
})();
