import { useEffect, useRef, useState } from 'react';

export default function LearningQuestion({ game, question, artStyle, onAnswer, onListen }) {
  const audio = game.activity_type === 'sound_picture_match';
  const [listened, setListened] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [starting, setStarting] = useState(false);
  const cancel = useRef(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current += 1; cancel.current?.(); };
  }, []);
  function listen() {
    if (game.phase !== 'playing') return;
    cancel.current?.(); const run = ++sequence.current;
    setStarting(true); setAudioError('');
    const current = () => mounted.current && sequence.current === run;
    try {
      cancel.current = onListen(question.target, {
        onStart: () => { if (current()) { setListened(true); setStarting(false); } },
        onError: message => { if (current()) { setAudioError(message); setStarting(false); } },
      });
    } catch { if (current()) { setAudioError('문제 소리를 재생하지 못했어요. 다시 듣거나 연습 목록에서 다른 연습을 골라 주세요.'); setStarting(false); } }
  }
  const locked = ['correct', 'incorrect'].includes(game.feedback);
  return <>
    <p className="eyebrow">{audio ? '소리를 듣고 같은 카드를 골라 보세요' : '그림과 같은 단어를 골라 보세요'}</p>
    <h3 id="learning-question-title">{audio ? '어떤 카드의 소리일까요?' : '이 그림은 무엇일까요?'}</h3>
    {audio ? <div className="learning-audio-prompt">
      <button type="button" disabled={game.phase !== 'playing'} aria-busy={starting} onClick={listen}>문제 소리 듣기</button>
      {starting && <p role="status">소리를 준비하고 있어요. 중지했으면 다시 눌러 주세요.</p>}
      {!listened && <p>먼저 문제 소리를 들어 주세요. 자동으로 재생하지 않아요.</p>}
      {audioError && <p role="alert">{audioError}</p>}
      {locked && <p>문제 단어: {question.target.label}</p>}
    </div> : <span className="learning-question-art" role="img" aria-label="문제 그림" style={artStyle(question.target)} />}
    <div className={`learning-options${audio ? ' audio-options' : ''}`} role="group" aria-label={audio ? '카드 보기' : '단어 보기'}>
      {question.options.map(option => {
        const selected = game.selectedId === option.id;
        const correct = game.feedback === 'correct' && option.id === question.target.id;
        const incorrect = selected && ['retry', 'incorrect'].includes(game.feedback);
        return <button type="button" key={option.id} className={correct ? 'correct' : incorrect ? 'incorrect' : ''}
          aria-pressed={selected} disabled={game.phase !== 'playing' || locked || (audio && !listened) || (game.feedback === 'retry' && selected)}
          onClick={() => onAnswer(option.id)}>
          {audio && <span className="learning-option-art" aria-hidden="true" style={artStyle(option)} />}{option.label}
        </button>;
      })}
    </div>
  </>;
}
