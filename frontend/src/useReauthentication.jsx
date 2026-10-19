import { useCallback, useEffect, useRef, useState } from 'react';

function PasswordConfirmation({ operation, onComplete }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const [password, setPassword] = useState('');
  useEffect(() => {
    const previous = operation.trigger;
    dialog.current.showModal();
    input.current.focus();
    return () => {
      // The triggering button can remain disabled until its async cancellation settles.
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus(); });
    };
  }, []);
  function keepFocusInside(event) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('input, button')].filter(control => !control.disabled);
    const first = controls[0];
    const last = controls.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
  return <dialog ref={dialog} className="reauthentication-dialog" aria-labelledby="reauthentication-title"
    aria-describedby="reauthentication-detail" onKeyDown={keepFocusInside}
    onCancel={event => { event.preventDefault(); onComplete(null); }}>
    <h2 id="reauthentication-title">운영 작업 확인</h2>
    <p><strong>{operation.title}</strong></p>
    <p id="reauthentication-detail">{operation.description}</p>
    <p>이 작업을 실행하려면 로그인한 본인의 비밀번호를 다시 입력해 주세요. 작업마다 확인하며 저장하지 않습니다.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!password || !navigator.onLine) return;
      const verification = password;
      setPassword('');
      onComplete(verification);
    }}>
      <label>본인 비밀번호<input ref={input} type="password" required maxLength="128" autoComplete="current-password"
        value={password} onChange={event => setPassword(event.target.value)} /></label>
      <div className="reauthentication-actions"><button type="button" onClick={() => onComplete(null)}>취소</button>
        <button className="primary" disabled={!password}>확인 후 실행</button></div>
    </form>
  </dialog>;
}

export default function useReauthentication(context) {
  const resolver = useRef(null);
  const [operation, setOperation] = useState(null);
  const complete = useCallback(value => {
    const done = resolver.current;
    resolver.current = null;
    setOperation(null);
    done?.(value);
  }, []);
  useEffect(() => { complete(null); }, [context, complete]);
  useEffect(() => {
    const cancel = () => complete(null);
    const events = ['offline', 'pesc-mate:session-expired', 'storage'];
    events.forEach(name => window.addEventListener(name, cancel));
    return () => {
      events.forEach(name => window.removeEventListener(name, cancel));
      const done = resolver.current;
      resolver.current = null;
      done?.(null);
    };
  }, [complete]);
  function askPassword(title, description) {
    if (resolver.current || !navigator.onLine) return Promise.resolve(null);
    return new Promise(resolve => {
      resolver.current = resolve;
      setOperation({ title, description, trigger: document.activeElement });
    });
  }
  return { askPassword, confirmation: operation ? <PasswordConfirmation operation={operation} onComplete={complete} /> : null };
}
