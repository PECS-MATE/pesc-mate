import { useEffect, useId, useRef, useState } from 'react';

export default function CardEditorDialog({ editing, categories, targetName, privateOnly = false,
  busy, error, onSubmit, onClose }) {
  const dialog = useRef(null);
  const errorMessage = useRef(null);
  const trigger = useRef(document.activeElement);
  const titleId = useId();
  const descriptionId = useId();
  const imageHelpId = useId();
  const [visibility, setVisibility] = useState(privateOnly ? 'private' : editing?.visibility || 'private');

  useEffect(() => {
    const modal = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    modal.querySelector('input[name="label"]')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        if (!modal.isConnected && trigger.current?.isConnected) trigger.current.focus();
      });
    };
  }, []);

  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  function keepFocusInside(event) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button, input, select, textarea, [tabindex]')]
      .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return <dialog ref={dialog} className="card-editor-dialog" aria-labelledby={titleId}
    aria-describedby={descriptionId} onKeyDown={keepFocusInside}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="card-editor-heading"><h2 id={titleId}>{editing ? '카드 수정' : privateOnly ? '개인 카드 등록' : '새 카드 등록'}</h2>
      <p id={descriptionId}>{privateOnly ? `${targetName}님만 사용하는 카드를 등록합니다.` : '카드 정보를 입력하고 사용할 범위를 골라 주세요.'}</p></header>
    <form className="card-editor-form" onSubmit={event => { if (busy) event.preventDefault(); else onSubmit(event); }}>
      <div className="card-editor-body">
        {error && <p ref={errorMessage} tabIndex="-1" role="alert" className="error">{error}</p>}
        <p className="card-editor-required">모든 입력 항목은 필수입니다.{editing && ' 기존 이미지는 유지됩니다.'}</p>
        <fieldset disabled={busy}>
          <legend className="visually-hidden">카드 정보</legend>
          <label>카드명<input name="label" required maxLength="30" placeholder="예: 연필" defaultValue={editing?.label || ''} /></label>
          <label>카드 뜻<textarea name="meaning" required maxLength="120" rows="3" placeholder="카드가 나타내는 뜻을 적어 주세요." defaultValue={editing?.meaning || ''} /></label>
          <label>카테고리<select name="category" required defaultValue={editing?.category || ''}>
            <option value="" disabled>카테고리 선택</option>{categories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
          </select></label>
          {privateOnly ? <input name="visibility" type="hidden" value="private" /> :
            <label>공개 범위<select name="visibility" value={visibility} onChange={event => setVisibility(event.target.value)}>
              <option value="private">나만 사용</option><option value="shared">승인 후 모두에게 공개</option>
            </select></label>}
          {!editing && <label>카드 이미지<input name="image" required type="file" accept="image/jpeg,image/png,image/webp"
            aria-describedby={imageHelpId} /></label>}
        </fieldset>
        {!editing && <p id={imageHelpId} className="form-notice">JPG·PNG·WebP, 5MB 이하, 가로·세로 128~4096px 이미지를 선택해 주세요.</p>}
        <p className="form-notice">{privateOnly ? '연결 사용자만 사용할 수 있으며 공개 승인 목록에는 표시되지 않습니다.'
          : visibility === 'shared' ? '공개 요청은 운영 담당자 승인 후 모든 사용자에게 표시됩니다.' : '저장하면 나만 사용할 수 있으며 운영 담당자에게 공유되지 않습니다.'}</p>
      </div>
      <footer className="card-editor-actions">
        <button type="button" disabled={busy} onClick={onClose}>취소</button>
        {!editing && <button type="submit" value="draft" disabled={busy}>임시 저장</button>}
        <button type="submit" value="submit" className="primary" disabled={busy}>{busy ? '저장 중…' : editing ? '수정 저장' : visibility === 'shared' ? '공개 승인 요청' : '카드 저장'}</button>
      </footer>
    </form>
    <button type="button" className="card-editor-close" disabled={busy} aria-label="카드 등록창 닫기" onClick={onClose}>×</button>
  </dialog>;
}
