import { useEffect, useRef, useState } from 'react';
import { request } from './services/api';
import UsbRfidReader from './UsbRfidReader';
import { CardPreview } from './RfidChipRegistration';

export default function RfidChipCheckPage({ accountId, artStyle }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const token = localStorage.getItem('pesc-mate-token');
  useEffect(() => {
    setResult(null); setError('');
    return () => { ++revision.current; };
  }, [accountId, token]);

  async function scan(uid) {
    const run = ++revision.current;
    setResult({ uid, loading: true }); setError('');
    const current = () => run === revision.current && token && localStorage.getItem('pesc-mate-token') === token;
    try {
      const catalog = await request('/rfid/admin/catalog');
      if (!current()) return;
      const binding = catalog.bindings.find(row => row.uid === uid);
      const card = binding && binding.available !== false ? catalog.cards.find(row => row.id === binding.card_id) : null;
      setResult({ uid, binding, card, loading: false });
    } catch (failure) {
      if (current()) { setResult({ uid, loading: false }); setError(failure.message || '서버 연결을 확인해 주세요.'); }
    }
  }

  return <section className="chip-registration" aria-label="RFID 칩 연결 확인">
    <h2>RFID 칩 연결 확인</h2>
    <p>칩을 하나씩 스캔하면 연결된 공용 카드가 표시됩니다. 다음 칩을 스캔하면 결과가 자동으로 바뀝니다.</p>
    <UsbRfidReader targetId={accountId} manager registration eventScope="shared" onUid={scan} />
    <div className="chip-preview-surface" role="status" aria-live="polite" aria-atomic="true">
      {!result ? <p>확인할 칩을 리더기에 대세요.</p> : <>
        <p>UID: <strong>{result.uid}</strong></p>
        {result.loading ? <p>칩 연결을 확인하는 중입니다…</p> : error ? <p>연결 정보를 확인하지 못했습니다. 칩을 떼었다가 다시 대세요.</p>
          : result.card ? <><CardPreview key={result.card.id} card={result.card} artStyle={artStyle} /><strong>{result.card.label}</strong><small>{result.card.category}</small><p>공용 카드에 연결된 칩입니다.</p></>
            : <p>{result.binding ? '연결된 공용 카드를 현재 사용할 수 없습니다.' : '공용 카드에 등록되지 않은 칩입니다.'}</p>}
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
