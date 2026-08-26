/**
 * @nowly-module 1
 * @id           my-animated
 * @name         动效模块
 * @version      1.0.0
 * @author       yourname
 * @description  演示持续动效如何响应可见性暂停
 * @motion       animated
 * @minSize      2x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';

  // 一个跟随时间平移的进度条，作为“持续动效”的示例。用 nm-* 令牌上色，
  // 不写任何颜色字面量。
  const track = document.createElement('div');
  track.style.height = '6px';
  track.style.borderRadius = '3px';
  track.style.background = 'var(--nm-surface-sunken)';
  track.style.overflow = 'hidden';

  const bar = document.createElement('div');
  bar.style.height = '100%';
  bar.style.width = '0%';
  bar.style.background = 'var(--nm-accent)';
  track.appendChild(bar);
  card.appendChild(track);
  root.appendChild(card);

  // rAF 循环：逐帧推进。start 记录起点，用于计算相位。
  let raf = 0;
  let start = 0;
  function frame(now) {
    if (!start) start = now;
    const phase = ((now - start) / 2000) % 1; // 每 2 秒一个周期
    bar.style.width = Math.round(phase * 100) + '%';
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function pause() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      start = 0;
    }
  }

  // 强制：不可见时必须暂停循环，可见时恢复。注册时会立即回调一次当前状态，
  // 所以这里不需要额外的初始 play()。
  host.onVisibilityChange(function (visible) {
    if (visible) play();
    else pause();
  });
});
