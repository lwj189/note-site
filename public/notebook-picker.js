/* 笔记本选择器：多选芯片 + 现场新建笔记本 + 自定义标签
 * 用法：createNotebookPicker(rootEl, { all, selected, hiddenInput, onChange })
 * 选择结果写回 hiddenInput（逗号分隔），与原有 tags 字段完全兼容。
 */
(function () {
  // 安全读取 JSON 响应：服务器返回 HTML（413/404/500 错误页）时给出可读提示，
  // 而不是让前端抛出 "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"
  function readJSON(res) {
    return res.text().then(function (text) {
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') >= 0) {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('服务器返回的 JSON 无法解析（HTTP ' + res.status + '）'); }
      }
      var tip = '服务器返回了非 JSON 响应（HTTP ' + res.status + '）';
      if (res.status === 413) tip = '内容过大，超过服务器允许的请求体上限（HTTP 413）';
      else if (res.status === 404) tip = '接口不存在（HTTP 404），可能是应用还没重启加载新代码';
      else if (res.status >= 500) tip = '服务器内部错误（HTTP ' + res.status + '）';
      throw new Error(tip);
    });
  }
  window.readJSON = readJSON;

  function createNotebookPicker(root, opts) {
    if (!root) return null;
    opts = opts || {};
    var all = (opts.all || []).map(function (n) {
      var name = typeof n === 'string' ? n : n.name;
      return {
        name: name,
        color: (typeof n === 'string' ? '#4361ee' : (n.color || '#4361ee')),
        icon: (typeof n === 'string' ? '📁' : (n.icon || '📁'))
      };
    });
    var selected = (opts.selected || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    var onChange = opts.onChange || function () {};
    var hiddenInput = opts.hiddenInput || null;
    var busy = false;

    function find(name) {
      for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
      return null;
    }
    function ensure(name, color, icon) {
      if (!find(name)) all.push({ name: name, color: color || '#64748b', icon: icon || '🏷' });
    }
    selected.forEach(function (n) { ensure(n); });

    function sync() {
      if (hiddenInput) hiddenInput.value = selected.join(', ');
      onChange(selected.slice());
    }

    function render() {
      root.innerHTML = '';
      root.className = 'nb-picker';

      var chips = document.createElement('div');
      chips.className = 'nb-chips';
      if (!all.length) {
        var empty = document.createElement('span');
        empty.className = 'nb-empty';
        empty.textContent = '还没有笔记本，在下面输入名称新建一个';
        chips.appendChild(empty);
      }
      all.forEach(function (nb) {
        var on = selected.indexOf(nb.name) >= 0;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'nb-chip' + (on ? ' active' : '');
        b.style.setProperty('--nb-color', nb.color);
        b.title = on ? '点击移出「' + nb.name + '」' : '点击归入「' + nb.name + '」';

        var ico = document.createElement('span');
        ico.className = 'nb-chip-ico';
        ico.textContent = nb.icon;
        var txt = document.createElement('span');
        txt.className = 'nb-chip-name';
        txt.textContent = nb.name;
        b.appendChild(ico);
        b.appendChild(txt);
        if (on) {
          var x = document.createElement('span');
          x.className = 'nb-chip-x';
          x.textContent = '×';
          b.appendChild(x);
        }
        b.onclick = function () {
          var i = selected.indexOf(nb.name);
          if (i >= 0) selected.splice(i, 1); else selected.push(nb.name);
          sync();
          render();
        };
        chips.appendChild(b);
      });
      root.appendChild(chips);

      var tools = document.createElement('div');
      tools.className = 'nb-tools';

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'nb-new-input';
      input.placeholder = '输入名称：可新建笔记本 / 加自定义标签';

      var btnNb = document.createElement('button');
      btnNb.type = 'button';
      btnNb.className = 'nb-tool-btn';
      btnNb.textContent = '＋ 新建笔记本';

      var btnTag = document.createElement('button');
      btnTag.type = 'button';
      btnTag.className = 'nb-tool-btn nb-tool-btn-ghost';
      btnTag.textContent = '＋ 自定义标签';

      var msg = document.createElement('span');
      msg.className = 'nb-tool-msg';

      function submit(raw, createNb) {
        var name = String(raw || '').trim();
        if (!name) { msg.textContent = '请先输入名称'; input.focus(); return; }
        if (!createNb) {
          if (selected.indexOf(name) >= 0) { msg.textContent = '已选中「' + name + '」'; return; }
          ensure(name);
          selected.push(name);
          msg.textContent = '';
          sync();
          render();
          return;
        }
        if (busy) return;
        busy = true;
        msg.textContent = '创建中…';
        fetch('/api/notebooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        }).then(readJSON).then(function (d) {
          busy = false;
          if (!d || !d.ok) { msg.textContent = (d && d.error) || '创建失败'; return; }
          ensure(d.name, d.color, d.icon);
          if (selected.indexOf(d.name) < 0) selected.push(d.name);
          sync();
          render();
        }).catch(function (err) {
          busy = false;
          msg.textContent = '创建失败：' + err.message;
        });
      }

      btnNb.onclick = function () { submit(input.value, true); };
      btnTag.onclick = function () { submit(input.value, false); };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(input.value, true); }
      });

      tools.appendChild(input);
      tools.appendChild(btnNb);
      tools.appendChild(btnTag);
      tools.appendChild(msg);
      root.appendChild(tools);
    }

    render();
    sync();

    return {
      getSelected: function () { return selected.slice(); },
      setSelected: function (list) {
        selected = (list || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
        selected.forEach(function (n) { ensure(n); });
        sync();
        render();
      },
      refresh: render
    };
  }

  window.createNotebookPicker = createNotebookPicker;
})();
