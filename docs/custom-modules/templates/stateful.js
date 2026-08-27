/**
 * @nowly-module 1
 * @id           my-counter
 * @name         计数器
 * @version      1.0.0
 * @author       yourname
 * @description  带持久化的计数器
 * @permissions  state, today
 * @minSize      3x3
 * @defaultSize  4x4
 */
Nowly.defineModule(async ({ host, root }) => {
  let state = (await host.loadState()) || { count: 0 };

  function button(label, variant, onClick) {
    const el = document.createElement('button');
    el.className = variant ? 'nm-btn nm-btn--' + variant : 'nm-btn';
    el.textContent = label;
    el.onclick = onClick;
    return el;
  }

  function render() {
    root.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'nm-card';

    if (host.todayIso) {
      const date = document.createElement('p');
      date.className = 'nm-muted';
      date.style.margin = '0 0 12px';
      date.textContent = '今天：' + host.todayIso;
      card.appendChild(date);
    }

    const value = document.createElement('p');
    value.className = 'nm-title';
    value.style.margin = '0 0 16px';
    value.textContent = '计数：' + state.count;
    card.appendChild(value);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.appendChild(button('+1', 'primary', async () => {
      state = { count: state.count + 1 };
      await host.saveState(state);
      render();
    }));
    row.appendChild(button('重置', '', async () => {
      state = { count: 0 };
      await host.saveState(state);
      render();
    }));
    card.appendChild(row);
    root.appendChild(card);
  }

  render();
});
