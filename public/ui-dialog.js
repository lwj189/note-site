// 轻量对话框：Electron 不支持 window.prompt()，统一用页面内弹窗
// uiPrompt({title, message, value, placeholder, okText}) -> Promise<string|null>
// uiConfirm({title, message, okText, danger}) -> Promise<boolean>
// uiSelect({title, message, options: [{label, value}], okText}) -> Promise<value|null>
(function () {
  function make(tag, cls) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function open(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = make('div', 'uid-overlay');
      var box = make('div', 'uid-box');

      if (opts.title) {
        var title = make('div', 'uid-title');
        title.textContent = opts.title;
        box.appendChild(title);
      }
      if (opts.message) {
        var msg = make('div', 'uid-msg');
        msg.textContent = opts.message;
        box.appendChild(msg);
      }

      var input = null;
      var selectWrap = null;
      if (opts.type === 'prompt') {
        input = make('input', 'uid-input');
        input.type = 'text';
        input.value = opts.value || '';
        input.placeholder = opts.placeholder || '';
        box.appendChild(input);
      } else if (opts.type === 'select') {
        selectWrap = make('div', 'uid-options');
        (opts.options || []).forEach(function (opt) {
          var b = make('button', 'uid-option');
          b.type = 'button';
          b.textContent = opt.label;
          b.addEventListener('click', function () { close(opt.value); });
          selectWrap.appendChild(b);
        });
        box.appendChild(selectWrap);
      }

      var actions = make('div', 'uid-actions');
      var cancel = make('button', 'btn btn-sm btn-outline');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function () { close(null); });
      actions.appendChild(cancel);

      if (opts.type !== 'select') {
        var ok = make('button', 'btn btn-sm' + (opts.danger ? ' btn-danger' : ''));
        ok.type = 'button';
        ok.textContent = opts.okText || '确定';
        ok.addEventListener('click', function () { close(input ? input.value : true); });
        actions.appendChild(ok);
      }
      box.appendChild(actions);

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && input) { e.preventDefault(); e.stopPropagation(); close(input.value); }
      }
      window.addEventListener('keydown', onKey, true);

      function close(value) {
        window.removeEventListener('keydown', onKey, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }

      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(null); });

      if (input) { input.focus(); input.select(); }
      else if (selectWrap) { var firstOpt = selectWrap.querySelector('.uid-option'); if (firstOpt) firstOpt.focus(); }
    });
  }

  window.uiPrompt = function (opts) { return open(Object.assign({}, opts, { type: 'prompt' })); };
  window.uiConfirm = function (opts) { return open(Object.assign({}, opts, { type: 'confirm' })); };
  window.uiSelect = function (opts) { return open(Object.assign({}, opts, { type: 'select' })); };
  window.uiAlert = function (message, title) {
    return open({ type: 'confirm', title: title || '提示', message: message, okText: '知道了' });
  };
})();
