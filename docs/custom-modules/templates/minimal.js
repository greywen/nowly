/**
 * @nowly-module 1
 * @id           my-module
 * @name         我的模块
 * @version      1.0.0
 * @author       yourname
 * @description  一句话描述
 * @permissions  today
 * @minSize      2x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';

  const title = document.createElement('p');
  title.className = 'nm-title';
  title.textContent = '你好，Nowly';

  const today = document.createElement('p');
  today.className = 'nm-muted';
  today.style.margin = '8px 0 0';
  today.textContent = host.todayIso ? '今天：' + host.todayIso : '';

  card.appendChild(title);
  card.appendChild(today);
  root.appendChild(card);
});
