import { useState } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useModuleState, type ModuleHost } from './extension-module';

// Curated offline word list. "每日单词" picks today's card by date so the
// default view is stable, and the user can page through the set manually.
type VocabularyCard = { word: string; phonetic: string; meaning: string; example: string };

const WORDS: VocabularyCard[] = [
  { word: 'resilient', phonetic: '/rɪˈzɪliənt/', meaning: 'adj. 有韧性的，能快速恢复的', example: 'A resilient team recovers quickly from setbacks.' },
  { word: 'pragmatic', phonetic: '/præɡˈmætɪk/', meaning: 'adj. 务实的，讲求实际的', example: 'She took a pragmatic approach to the problem.' },
  { word: 'nuance', phonetic: '/ˈnuːɑːns/', meaning: 'n. 细微差别', example: 'He explained every nuance of the plan.' },
  { word: 'iterate', phonetic: '/ˈɪtəreɪt/', meaning: 'v. 迭代，反复', example: 'We iterate on the design each week.' },
  { word: 'coherent', phonetic: '/kəʊˈhɪərənt/', meaning: 'adj. 连贯的，一致的', example: 'The report was clear and coherent.' },
  { word: 'leverage', phonetic: '/ˈliːvərɪdʒ/', meaning: 'v. 利用，撬动', example: 'They leverage data to make decisions.' },
  { word: 'concise', phonetic: '/kənˈsaɪs/', meaning: 'adj. 简洁的', example: 'Keep the summary concise.' }
];

function dayIndex() {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  return Math.floor(diff / 86_400_000) % WORDS.length;
}

export function VocabularyWidget({ host }: { host: ModuleHost }) {
  const [index, setIndex] = useState(() => dayIndex());
  // Starred words persist through the module host so favourites survive restarts.
  const [starred, setStarred] = useModuleState<string[]>(host, []);
  const card = WORDS[index];
  const step = (delta: number) => setIndex((current) => (current + delta + WORDS.length) % WORDS.length);
  const isStarred = starred.includes(card.word);
  const toggleStar = () =>
    setStarred((current) =>
      current.includes(card.word)
        ? current.filter((word) => word !== card.word)
        : [...current, card.word]
    );

  return (
    <div className="widget-content vocabulary">
      <div className="card-header">
        <div className="heading-group">
          <h2>每日单词</h2>
        </div>
        <div className="toolbar-actions vocabulary__nav">
          <button
            type="button"
            className={`btn btn-icon vocabulary__star${isStarred ? ' is-active' : ''}`}
            aria-label={isStarred ? '取消收藏' : '收藏单词'}
            aria-pressed={isStarred}
            onClick={toggleStar}
          >
            <Star aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" aria-label="上一个单词" onClick={() => step(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" aria-label="下一个单词" onClick={() => step(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body vocabulary__body">
        <p className="vocabulary__word">{card.word}</p>
        <p className="vocabulary__phonetic">{card.phonetic}</p>
        <p className="vocabulary__meaning">{card.meaning}</p>
        <p className="vocabulary__example">{card.example}</p>
      </div>
    </div>
  );
}
