// Static "hot topics" word cloud. There is no network access in the desktop
// shell, so the keywords are a curated sample set. Font size encodes the heat,
// and there is no animation per design.md.
const KEYWORDS: Array<{ term: string; heat: number }> = [
  { term: '人工智能', heat: 5 },
  { term: '新能源', heat: 4 },
  { term: '开源', heat: 4 },
  { term: '芯片', heat: 3 },
  { term: '云计算', heat: 3 },
  { term: '大模型', heat: 5 },
  { term: '碳中和', heat: 2 },
  { term: '数据安全', heat: 3 },
  { term: '机器人', heat: 2 },
  { term: '量子计算', heat: 1 },
  { term: '航天', heat: 2 },
  { term: '智能制造', heat: 3 }
];

const HEAT_SIZE: Record<number, string> = {
  1: '13.6px',
  2: '15.2px',
  3: '17.2px',
  4: '20px',
  5: '24px'
};

// Static keyword cloud. It takes a host to satisfy the runnable-module contract
// but has no persisted state of its own.
export function NewsWordCloudWidget(_: { host: import('./extension-module').ModuleHost }) {
  return (
    <div className="widget-content news-cloud">
      <div className="card-header">
        <div className="heading-group">
          <h2>热点词云</h2>
        </div>
      </div>
      <div className="panel-body news-cloud__body">
        <ul className="news-cloud__list">
          {KEYWORDS.map((keyword) => (
            <li key={keyword.term}>
              <span className="news-cloud__word" style={{ fontSize: HEAT_SIZE[keyword.heat] }}>
                {keyword.term}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
