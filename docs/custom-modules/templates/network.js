/**
 * @nowly-module 1
 * @id           weather-widget
 * @name         天气
 * @version      1.0.0
 * @author       yourname
 * @description  显示当前城市的实时天气
 * @permissions  network
 * @network      api.open-meteo.com
 * @minSize      3x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';
  const line = document.createElement('p');
  line.className = 'nm-text';
  line.textContent = '加载中…';
  card.appendChild(line);
  root.appendChild(card);

  try {
    const res = await host.fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m'
    );
    const temp = res.json && res.json.current ? res.json.current.temperature_2m : null;
    line.textContent = temp != null ? '当前气温：' + temp + '°C' : '暂无数据';
  } catch (error) {
    line.className = 'nm-msg nm-msg--danger';
    line.textContent = '获取失败：' + error.message;
  }
});
