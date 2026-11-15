import { useEffect, useState } from 'react';
import HomeDashboard from '../HomeDashboard';
import { CardArt, CardPicture } from '../components/CardVisuals';
import UiIcon from '../UiIcon';
import { STEP_MS, captions, nextStep, sceneAt, selectedCountAt } from './promo-timeline';

// Scripted promotional examples; no account, learning record, or API writes.
const cards = [
  { id: 'me', label: '나' }, { id: 'water', label: '물' },
  { id: 'drink', label: '마시다' }, { id: 'rice', label: '밥' },
  { id: 'apple', label: '사과' }, { id: 'milk', label: '우유' },
  { id: 'eat', label: '먹다' }, { id: 'happy', label: '좋아요' },
];
const picture = (card, className) => <CardPicture key={card.id} card={card} className={className} />;

export default function PromoDemo() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const scene = sceneAt(step);
  const selected = cards.slice(0, selectedCountAt(step));

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => setStep(nextStep), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  useEffect(() => {
    function command(event) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== 'pecsmate:promo-command') return;
      if (event.data.command === 'toggle') setPlaying(value => !value);
      if (event.data.command === 'restart') { setStep(0); setPlaying(true); }
      if (event.data.command === 'next') { setStep(nextStep); setPlaying(false); }
    }
    window.addEventListener('message', command);
    return () => window.removeEventListener('message', command);
  }, []);

  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ type: 'pecsmate:promo-state', playing, step, total: captions.length }, window.location.origin);
  }, [playing, step]);

  function jump(next) { setStep(next); setPlaying(false); }

  return <div className={`promo-demo ${playing ? 'is-playing' : 'is-paused'}`}>
    <aside className="promo-sidebar">
      <img src="/pecsmate.png" alt="PECS MATE" />
      <span className="promo-wordmark">PECS MATE</span>
      <nav aria-label="시연 장면">
        {[[0, 'home', '홈'], [1, 'chat', '말하기'], [7, 'school', '연습하기']].map(([target, icon, label]) =>
          <button key={target} className={(target === 0 && scene === 'home') || (target === 1 && scene === 'cards') || (target === 7 && scene === 'practice') ? 'active' : ''} onClick={() => jump(target)}><UiIcon name={icon} />{label}</button>)}
      </nav>
      <span className="promo-example">시연용 예시 화면</span>
    </aside>
    <main className="promo-workspace">
      <header className="promo-header"><span>{scene === 'practice' ? '연습하기' : scene === 'cards' ? '그림으로 말하기' : '오늘도, 나답게 표현해요'}</span><span className="promo-profile">나의 공간 <span aria-hidden="true">●</span></span></header>
      <section className="promo-content" key={scene}>
        {scene === 'home' && <><p className="promo-eyebrow">반가워요!</p><h1>오늘은 어떤 이야기를 할까요?</h1><p className="promo-description">카드를 고르고, 나의 마음을 전해 보세요.</p><HomeDashboard selectedCount={0} cards={[cards[1], cards[4]]} renderPicture={picture} onSpeak={() => jump(1)} onPractice={() => jump(7)} /></>}
        {scene === 'cards' && <>
          <div className="promo-heading"><div><p className="promo-eyebrow">그림으로 말하기</p><h1>나의 문장을 만들어요</h1></div><span className="promo-chip">문장으로 말하기</span></div>
          <div className="promo-sentence" aria-label="선택한 카드">
            {selected.length ? selected.map(card => <div className="promo-mini" key={card.id}><CardArt card={card} /><b>{card.label}</b></div>) : <span className="promo-placeholder">아래에서 카드를 골라 담아 보세요</span>}
            <div className={`promo-speak ${step >= 5 ? 'highlight' : ''}`}><UiIcon name="volume_up" size={30} /><span>말하기</span></div>
          </div>
          {step >= 5 && <div className="promo-output"><span className={step === 6 ? 'promo-wave' : ''} aria-hidden="true">▂ ▅ ▃ ▇ ▄ ▆ ▂</span><strong>나는 물을 마시고 싶어요.</strong></div>}
          <div className="promo-categories"><span className="active">전체</span><span>사람</span><span>음식과 음료</span><span>동작</span><span>감정</span></div>
          <div className="promo-card-grid">{cards.map(card => <div key={card.id} className={`promo-card ${selected.some(item => item.id === card.id) ? 'selected' : ''}`}><CardArt card={card} /><strong>{card.label}</strong>{selected.some(item => item.id === card.id) && <span className="promo-check" aria-label="선택됨">✓</span>}</div>)}</div>
        </>}
        {scene === 'practice' && <>
          <div className="promo-heading"><div><p className="promo-eyebrow">단어·그림 맞추기</p><h1>{step === 9 ? '정답이에요, 잘했어요!' : '‘사과’ 카드를 찾아볼까요?'}</h1></div><span className="promo-chip">1 / 5</span></div>
          <div className="promo-practice"><CardArt card={cards[4]} /><span>{step === 9 ? '참 잘했어요!' : '사과'}</span></div>
          <div className="promo-answers">{[cards[1], cards[4], cards[3]].map(card => <div key={card.id} className={`promo-card ${step === 9 && card.id === 'apple' ? 'selected' : ''}`}><CardArt card={card} /><strong>{card.label}</strong>{step === 9 && card.id === 'apple' && <span className="promo-check">✓</span>}</div>)}</div>
        </>}
        {scene === 'closing' && <div className="promo-closing"><img src="/pecsmate.png" alt="PECS MATE 캐릭터" /><p className="promo-eyebrow">PECS MATE</p><h1>그림으로 전하는<br />나의 마음, 나의 목소리</h1><p>카드를 고르고, 문장을 만들고, 마음을 전해요.</p></div>}
      </section>
      <footer className="promo-caption"><span className="promo-caption-number">{String(step + 1).padStart(2, '0')}</span><span>{captions[step]}</span><div className="promo-progress" aria-label={`전체 ${captions.length}장면 중 ${step + 1}번째`}><span style={{ width: `${(step + 1) / captions.length * 100}%` }} /></div></footer>
    </main>
  </div>;
}
