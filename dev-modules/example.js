/**
 * @nowly-module 1
 * @id           preview-example
 * @name         预览示例
 * @version      1.0.0
 * @author       nowly
 * @description  演示预览工作台：套 nm-* 类、读今天日期、无颜色字面量
 * @permissions  today
 * @minSize      2x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';

  const title = document.createElement('p');
  title.className = 'nm-title';
  title.textContent = '预览示例';

  const today = document.createElement('p');
  today.className = 'nm-muted';
  today.style.margin = '8px 0 0';
  today.textContent = host.todayIso ? '今天：' + host.todayIso : '未授权 today';

  card.appendChild(title);
  card.appendChild(today);
  root.appendChild(card);
});
