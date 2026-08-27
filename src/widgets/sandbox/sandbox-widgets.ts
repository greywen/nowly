// Optional convenience widgets injected into the sandbox iframe (spec §4.4,
// step 4). Free-DOM modules would otherwise hand-roll Select / DatePicker /
// etc. and — per the design note — almost always ship a version you can click
// but not reach with the keyboard. These native-JS factories carry the full
// keyboard + ARIA behavior so a module author gets accessibility for free.
//
// They are pure DOM factories: no postMessage, no host access. Each returns an
// HTMLElement the author appends to `root`, plus `nowlyGetValue()` /
// `nowlySetValue(v)` helpers for controlled use. This string is injected AFTER
// the runtime, so it augments the existing `window.Nowly` (defineModule) rather
// than replacing it.
//
// Styling uses only the injected nm-* widget classes (see generate-module-css),
// so widgets stay theme-safe and never introduce color literals.
export const SANDBOX_WIDGETS = `(() => {
  var N = (window.Nowly = window.Nowly || {});
  var doc = document;

  function el(tag, cls, attrs) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    return node;
  }

  var uid = 0;
  function nextId(prefix) { uid += 1; return prefix + '-' + uid; }

  // --- Select ---------------------------------------------------------------
  // A combobox + listbox. Keyboard: Enter/Space/Down/Up open; Down/Up move the
  // active option; Home/End jump; Enter selects; Escape closes; typing a letter
  // jumps to the first matching label.
  N.Select = function (opts) {
    opts = opts || {};
    var options = opts.options || [];
    var value = opts.value != null ? opts.value : (options[0] ? options[0].value : '');
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var placeholder = opts.placeholder || '请选择';

    var listId = nextId('nm-listbox');
    var root = el('div', 'nm-select');
    if (opts.label) {
      var labelEl = el('label', 'nm-field-label');
      labelEl.textContent = opts.label;
      root.appendChild(labelEl);
    }
    var trigger = el('button', 'nm-select__trigger', {
      type: 'button', role: 'combobox', 'aria-haspopup': 'listbox',
      'aria-expanded': 'false', 'aria-controls': listId
    });
    if (opts.label) trigger.setAttribute('aria-label', opts.label);
    var valueText = el('span', 'nm-select__value');
    var caret = el('span', 'nm-select__caret', { 'aria-hidden': 'true' });
    caret.textContent = '▾';
    trigger.appendChild(valueText);
    trigger.appendChild(caret);
    var popup = el('div', 'nm-select__popup', { hidden: 'hidden' });
    var listbox = el('div', 'nm-select__listbox', { id: listId, role: 'listbox' });
    popup.appendChild(listbox);
    root.appendChild(trigger);
    root.appendChild(popup);

    var open = false;
    var activeIndex = 0;

    function labelFor(v) {
      for (var i = 0; i < options.length; i++) if (options[i].value === v) return options[i].label;
      return null;
    }
    function renderValue() {
      var l = labelFor(value);
      valueText.textContent = l != null ? l : placeholder;
      valueText.setAttribute('data-placeholder', l != null ? 'false' : 'true');
    }
    function renderList() {
      listbox.textContent = '';
      for (var i = 0; i < options.length; i++) {
        (function (opt, index) {
          var optId = listId + '-' + index;
          var item = el('div', 'nm-select__option', {
            id: optId, role: 'option',
            'aria-selected': opt.value === value ? 'true' : 'false'
          });
          item.textContent = opt.label;
          if (index === activeIndex) item.setAttribute('data-active', 'true');
          item.addEventListener('mouseenter', function () { setActive(index); });
          item.addEventListener('click', function () { choose(index); });
          listbox.appendChild(item);
        })(options[i], i);
      }
    }
    function setActive(i) {
      if (!options.length) return;
      activeIndex = (i + options.length) % options.length;
      var items = listbox.children;
      for (var j = 0; j < items.length; j++) {
        if (j === activeIndex) items[j].setAttribute('data-active', 'true');
        else items[j].removeAttribute('data-active');
      }
      var act = items[activeIndex];
      if (act) trigger.setAttribute('aria-activedescendant', act.id);
    }
    function openList() {
      if (open || !options.length) return;
      open = true;
      popup.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      var cur = 0;
      for (var i = 0; i < options.length; i++) if (options[i].value === value) cur = i;
      setActive(cur);
    }
    function closeList() {
      if (!open) return;
      open = false;
      popup.setAttribute('hidden', 'hidden');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
    }
    function choose(i) {
      var opt = options[i];
      if (!opt) return;
      value = opt.value;
      renderValue();
      renderList();
      closeList();
      trigger.focus();
      onChange(value);
    }

    trigger.addEventListener('click', function () { open ? closeList() : openList(); });
    trigger.addEventListener('keydown', function (e) {
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); openList();
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); closeList(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(activeIndex); }
      else if (e.key.length === 1) {
        var q = e.key.toLowerCase();
        for (var i = 0; i < options.length; i++) {
          if (String(options[i].label).toLowerCase().indexOf(q) === 0) { setActive(i); break; }
        }
      }
    });
    trigger.addEventListener('blur', function () {
      // Close when focus leaves the whole widget.
      setTimeout(function () { if (!root.contains(doc.activeElement)) closeList(); }, 0);
    });

    renderValue();
    renderList();
    root.nowlyGetValue = function () { return value; };
    root.nowlySetValue = function (v) { value = v; renderValue(); renderList(); };
    return root;
  };

  // --- Tabs -----------------------------------------------------------------
  // role=tablist with roving tabindex. Left/Right (and Home/End) move + activate
  // (automatic activation), toggling the associated panels.
  N.Tabs = function (opts) {
    opts = opts || {};
    var tabs = opts.tabs || [];
    var value = opts.value != null ? opts.value : (tabs[0] ? tabs[0].id : '');
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var root = el('div', 'nm-tabs');
    var list = el('div', 'nm-tabs__list', { role: 'tablist' });
    var panelsWrap = el('div', 'nm-tabs__panels');
    root.appendChild(list);
    root.appendChild(panelsWrap);

    var tabEls = [];
    var panelEls = [];

    function select(id, focus) {
      value = id;
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].id === id;
        tabEls[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabEls[i].setAttribute('tabindex', on ? '0' : '-1');
        panelEls[i].hidden = !on;
        if (on && focus) tabEls[i].focus();
      }
      onChange(id);
    }
    function move(delta) {
      var cur = 0;
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === value) cur = i;
      var next = (cur + delta + tabs.length) % tabs.length;
      select(tabs[next].id, true);
    }

    for (var i = 0; i < tabs.length; i++) {
      (function (tab, index) {
        var tabId = nextId('nm-tab');
        var panelId = nextId('nm-tabpanel');
        var on = tab.id === value;
        var tabBtn = el('button', 'nm-tabs__tab', {
          type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId,
          'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1'
        });
        tabBtn.textContent = tab.label;
        tabBtn.addEventListener('click', function () { select(tab.id, false); });
        tabBtn.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          else if (e.key === 'Home') { e.preventDefault(); select(tabs[0].id, true); }
          else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1].id, true); }
        });
        var panel = el('div', 'nm-tabs__panel', { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId });
        panel.hidden = !on;
        if (tab.panel && tab.panel.nodeType) panel.appendChild(tab.panel);
        else panel.textContent = tab.panel != null ? tab.panel : '';
        tabEls.push(tabBtn);
        panelEls.push(panel);
        list.appendChild(tabBtn);
        panelsWrap.appendChild(panel);
      })(tabs[i], i);
    }

    root.nowlyGetValue = function () { return value; };
    root.nowlySetValue = function (v) { select(v, false); };
    return root;
  };

  // --- ColorPicker ----------------------------------------------------------
  // A radio group of preset swatches. Arrow keys move + select the swatch
  // (roving tabindex). The default palette lives here (not in module source) so
  // authors never write color literals. Callers can pass their own swatches.
  N.ColorPicker = function (opts) {
    opts = opts || {};
    var swatches = opts.swatches || [
      '#f06445', '#e8c444', '#b8d935', '#4fc9da', '#4f55da', '#211f1c', '#968e7e', '#ffffff'
    ];
    var value = opts.value != null ? opts.value : swatches[0];
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var root = el('div', 'nm-colorpicker');
    if (opts.label) {
      var labelEl = el('label', 'nm-field-label');
      labelEl.textContent = opts.label;
      root.appendChild(labelEl);
    }
    var group = el('div', 'nm-colorpicker__group', { role: 'radiogroup' });
    if (opts.label) group.setAttribute('aria-label', opts.label);
    root.appendChild(group);

    var radios = [];
    function select(i, focus) {
      value = swatches[i];
      for (var j = 0; j < radios.length; j++) {
        var on = j === i;
        radios[j].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[j].setAttribute('tabindex', on ? '0' : '-1');
        if (on && focus) radios[j].focus();
      }
      onChange(value);
    }
    function indexOfValue() {
      for (var i = 0; i < swatches.length; i++) if (swatches[i] === value) return i;
      return 0;
    }
    function move(delta) {
      var next = (indexOfValue() + delta + swatches.length) % swatches.length;
      select(next, true);
    }

    for (var i = 0; i < swatches.length; i++) {
      (function (color, index) {
        var on = color === value;
        var radio = el('button', 'nm-colorpicker__swatch', {
          type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false',
          'aria-label': color, tabindex: on ? '0' : '-1'
        });
        // The chosen color is applied inline — a user value, not a source
        // literal, so it does not run afoul of the module linter.
        radio.style.background = color;
        radio.addEventListener('click', function () { select(index, false); });
        radio.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(index, false); }
        });
        radios.push(radio);
        group.appendChild(radio);
      })(swatches[i], i);
    }

    root.nowlyGetValue = function () { return value; };
    // Reflect a new value in the DOM without firing onChange (controlled set).
    root.nowlySetValue = function (v) {
      value = v;
      var idx = indexOfValue();
      for (var i = 0; i < radios.length; i++) {
        var on = i === idx;
        radios[i].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[i].setAttribute('tabindex', on ? '0' : '-1');
      }
    };
    return root;
  };

  // --- TimePicker -----------------------------------------------------------
  // A combobox whose listbox is generated times from 00:00 at \`step\` minutes.
  // Reuses Select for the interaction so behavior stays identical.
  N.TimePicker = function (opts) {
    opts = opts || {};
    var step = opts.step > 0 ? opts.step : 30;
    var times = [];
    for (var m = 0; m < 24 * 60; m += step) {
      var hh = String(Math.floor(m / 60));
      var mm = String(m % 60);
      var t = (hh.length < 2 ? '0' + hh : hh) + ':' + (mm.length < 2 ? '0' + mm : mm);
      times.push({ value: t, label: t });
    }
    return N.Select({
      label: opts.label,
      options: times,
      value: opts.value != null ? opts.value : times[0].value,
      placeholder: opts.placeholder || '选择时间',
      onChange: opts.onChange
    });
  };

  // --- DatePicker -----------------------------------------------------------
  // A button that opens a month grid (role=grid). Arrow keys move the focused
  // day (wrapping across weeks), PageUp/PageDown change the month, Enter/Space
  // select, Escape closes. Values are ISO \`YYYY-MM-DD\`.
  N.DatePicker = function (opts) {
    opts = opts || {};
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    var value = opts.value || isoOf(new Date());
    var view = parseIso(value) || new Date();
    var focusDate = parseIso(value) || new Date();

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseIso(s) {
      var m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s || '');
      if (!m) return null;
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }

    var gridId = nextId('nm-dategrid');
    var root = el('div', 'nm-datepicker');
    if (opts.label) {
      var labelEl = el('label', 'nm-field-label');
      labelEl.textContent = opts.label;
      root.appendChild(labelEl);
    }
    var trigger = el('button', 'nm-datepicker__trigger nm-input', {
      type: 'button', 'aria-haspopup': 'grid', 'aria-expanded': 'false', 'aria-controls': gridId
    });
    if (opts.label) trigger.setAttribute('aria-label', opts.label);
    var popup = el('div', 'nm-datepicker__popup', { hidden: 'hidden' });
    var header = el('div', 'nm-datepicker__header');
    var prev = el('button', 'nm-datepicker__nav', { type: 'button', 'aria-label': '上个月' });
    prev.textContent = '‹';
    var monthLabel = el('span', 'nm-datepicker__month', { 'aria-live': 'polite' });
    var next = el('button', 'nm-datepicker__nav', { type: 'button', 'aria-label': '下个月' });
    next.textContent = '›';
    header.appendChild(prev);
    header.appendChild(monthLabel);
    header.appendChild(next);
    var grid = el('div', 'nm-datepicker__grid', { id: gridId, role: 'grid' });
    popup.appendChild(header);
    popup.appendChild(grid);
    root.appendChild(trigger);
    root.appendChild(popup);

    var open = false;
    function renderTrigger() { trigger.textContent = value || '选择日期'; }
    function sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function renderGrid() {
      monthLabel.textContent = view.getFullYear() + '年' + (view.getMonth() + 1) + '月';
      grid.textContent = '';
      var weekdays = ['一', '二', '三', '四', '五', '六', '日'];
      var head = el('div', 'nm-datepicker__weekdays', { role: 'row' });
      for (var w = 0; w < 7; w++) {
        var wd = el('span', 'nm-datepicker__weekday', { role: 'columnheader' });
        wd.textContent = weekdays[w];
        head.appendChild(wd);
      }
      grid.appendChild(head);
      var first = new Date(view.getFullYear(), view.getMonth(), 1);
      // Monday-first offset.
      var offset = (first.getDay() + 6) % 7;
      var daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      var row = null;
      for (var slot = 0; slot < offset; slot++) {
        if (slot % 7 === 0) { row = el('div', 'nm-datepicker__week', { role: 'row' }); grid.appendChild(row); }
        row.appendChild(el('span', 'nm-datepicker__day nm-datepicker__day--blank'));
      }
      for (var day = 1; day <= daysInMonth; day++) {
        (function (d) {
          var pos = offset + d - 1;
          if (pos % 7 === 0) { row = el('div', 'nm-datepicker__week', { role: 'row' }); grid.appendChild(row); }
          var date = new Date(view.getFullYear(), view.getMonth(), d);
          var isFocus = sameDay(date, focusDate);
          var isSel = parseIso(value) && sameDay(date, parseIso(value));
          var cell = el('button', 'nm-datepicker__day', {
            type: 'button', role: 'gridcell', tabindex: isFocus ? '0' : '-1',
            'aria-selected': isSel ? 'true' : 'false'
          });
          cell.textContent = String(d);
          cell.addEventListener('click', function () { pick(date); });
          row.appendChild(cell);
        })(day);
      }
      var focusCell = grid.querySelector('[tabindex="0"]');
      if (open && focusCell) focusCell.focus();
    }
    function pick(date) {
      value = isoOf(date);
      renderTrigger();
      closeCal();
      trigger.focus();
      onChange(value);
    }
    function openCal() {
      if (open) return;
      open = true;
      focusDate = parseIso(value) || new Date();
      view = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      popup.removeAttribute('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      renderGrid();
    }
    function closeCal() {
      if (!open) return;
      open = false;
      popup.setAttribute('hidden', 'hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function shiftFocus(days) {
      focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate() + days);
      view = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      renderGrid();
    }
    function shiftMonth(delta) {
      view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
      focusDate = new Date(view.getFullYear(), view.getMonth(), Math.min(focusDate.getDate(), new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()));
      renderGrid();
    }

    trigger.addEventListener('click', function () { open ? closeCal() : openCal(); });
    trigger.addEventListener('keydown', function (e) {
      if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); openCal(); }
    });
    prev.addEventListener('click', function () { shiftMonth(-1); });
    next.addEventListener('click', function () { shiftMonth(1); });
    grid.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); shiftFocus(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); shiftFocus(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); shiftFocus(7); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); shiftFocus(-7); }
      else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCal(); trigger.focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focusDate); }
    });
    root.addEventListener('focusout', function () {
      setTimeout(function () { if (open && !root.contains(doc.activeElement)) closeCal(); }, 0);
    });

    renderTrigger();
    root.nowlyGetValue = function () { return value; };
    root.nowlySetValue = function (v) { value = v; renderTrigger(); if (open) renderGrid(); };
    return root;
  };
})();`;
