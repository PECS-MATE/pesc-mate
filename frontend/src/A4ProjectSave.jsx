import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { request } from './services/api';
import { createRequestId } from './services/requestId';
import { A4_TOPICS, makeShareProject, projectRows } from './services/a4Sharing';
import { A4Pages } from './A4Workspace';
import UiIcon from './UiIcon';
import './assets/a4Sharing.css';

function SaveDialog({ project, initialTitle, onClose, onSaved }) {
  const dialog = useRef(null), mounted = useRef(false), working = useRef(false);
  const trigger = useRef(document.activeElement), titleId = useId();
  const [publish, setPublish] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const requestId = useRef(createRequestId());
  useEffect(() => {
    mounted.current = true; dialog.current.showModal();
    return () => { mounted.current = false; if (trigger.current?.isConnected) trigger.current.focus(); };
  }, []);
  async function save(event) {
    event.preventDefault(); if (working.current) return;
    working.current = true; setBusy(true); setError('');
    const token = localStorage.getItem('pesc-mate-token');
    const fields = new FormData(event.currentTarget);
    try {
      const result = await request('/a4/projects', { method: 'POST', timeoutMs: 45000, body: JSON.stringify({
        request_id: requestId.current, title: fields.get('title').trim(), description: fields.get('description').trim(),
        topic: fields.get('topic'), publish, rights_confirmed: fields.get('rights') === 'on',
        privacy_confirmed: fields.get('privacy') === 'on', project,
      }) });
      if (mounted.current && token === localStorage.getItem('pesc-mate-token')) { setSaved(result); onSaved(result); }
    } catch (failure) {
      if (mounted.current && token === localStorage.getItem('pesc-mate-token')) setError(`${failure.message} 응답이 끊겼다면 내 보관함에서 저장 여부를 확인해 주세요.`);
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="a4-sharing-dialog" aria-labelledby={titleId}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>카드판 저장·공유</h2><button type="button" disabled={busy} aria-label="저장창 닫기" onClick={onClose}><UiIcon name="close" /></button></header>
    <div className="a4-sharing-preview"><div className="a4-sharing-pages"><A4Pages rows={projectRows(project)} layout={project.layout} duplex={project.duplex} /></div></div>
    {saved ? <><p role="status">{saved.status === 'pending' ? '승인을 요청했어요. 승인 전에는 다른 보호자에게 보이지 않아요.' : '내 보관함에 비공개로 저장했어요.'}</p><button type="button" onClick={onClose}>닫기</button></> : <form onSubmit={save} onChange={() => { requestId.current = createRequestId(); }}>
      <fieldset disabled={busy}><legend className="visually-hidden">카드판 정보</legend>
        <label>제목<input name="title" maxLength="60" required defaultValue={initialTitle || '나의 그림 카드판'} /></label>
        <label>주제<select name="topic" defaultValue="기타">{A4_TOPICS.map(topic => <option key={topic}>{topic}</option>)}</select></label>
        <label>짧은 설명<textarea name="description" rows="2" maxLength="240" /></label>
        <label className="a4-sharing-check"><input type="checkbox" checked={publish} onChange={event => setPublish(event.target.checked)} />다른 보호자에게 공유 승인 요청</label>
        {publish && <><p>위 미리보기의 모든 쪽·문구·사진이 공개됩니다. 다른 보호자는 복사·맞춤 편집·재공유·인쇄할 수 있습니다. 이미 복사·인쇄한 사본은 공유 중단 후에도 회수할 수 없습니다.</p>
          <label className="a4-sharing-check"><input name="rights" type="checkbox" required />사진·그림을 공유하고 다른 보호자가 복사·수정·재공유·인쇄하도록 허용할 권한이 있습니다.</label>
          <label className="a4-sharing-check"><input name="privacy" type="checkbox" required />모든 쪽에 아이 이름·연락처·민감한 정보가 없는지 확인했고, 인물이 있는 사진의 공개 권한도 확인했습니다.</label></>}
        <p>아이 계정 사용 설정과는 별개이며, 배치하지 않은 사진과 아이 계정 정보는 포함하지 않습니다.</p>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary" disabled={busy}>{busy ? '저장 중…' : publish ? '공유 승인 요청' : '내 보관함에 새 편집본 저장'}</button></footer>
    </form>}
  </dialog>, document.body);
}

export default function A4ProjectSave({ rows, layout, duplex = false, disabled, initialTitle, onNotice }) {
  const [project, setProject] = useState(null), [busy, setBusy] = useState(false);
  const mounted = useRef(false), latestDisabled = useRef(disabled), working = useRef(false);
  latestDisabled.current = disabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function prepare() {
    if (working.current || disabled) return;
    working.current = true; setBusy(true);
    const token = localStorage.getItem('pesc-mate-token');
    try {
      const value = await makeShareProject(rows, layout, duplex);
      if (mounted.current && !latestDisabled.current && token === localStorage.getItem('pesc-mate-token')) setProject(value);
    } catch (error) { if (mounted.current) onNotice(error.message); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return <><button type="button" disabled={disabled || busy} aria-label={busy ? '공유 미리보기 준비 중' : '편집본 저장·공유'} title="편집본 저장·공유" onClick={prepare}><UiIcon name="share" /></button>
    {project && <SaveDialog project={project} initialTitle={initialTitle} onClose={() => setProject(null)} onSaved={result => onNotice(result.status === 'pending' ? '공유 승인 대기 중이에요. 보호자 홈의 내 보관함에서 확인하세요.' : '보호자 홈의 내 보관함에 저장했어요.')} />}</>;
}
