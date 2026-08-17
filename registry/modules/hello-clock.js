/**
 * @nowly-module 1
 * @id           hello-clock
 * @name         今日时钟
 * @version      1.0.0
 * @author       nowly
 * @description  显示今天的日期与一个本地走动的时钟，演示无联网的纯展示模块
 * @permissions  today
 * @minSize      3x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  root.style.fontFamily =
    'Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif';
  root.style.color = '#211F1C';

  const date = document.createElement('p');
  date.style.margin = '0 0 8px';
  date.style.color = '#968E7E';
  date.style.fontSize = '13.6px';
  date.textContent = host.todayIso ? '今天：' + host.todayIso : '';

  const clock = document.createElement('p');
  clock.style.margin = '0';
  clock.style.fontSize = '28px';
  clock.style.fontWeight = '600';

  root.appendChild(date);
  root.appendChild(clock);

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clock.textContent = hh + ':' + mm + ':' + ss;
  }

  tick();
  setInterval(tick, 1000);
});
