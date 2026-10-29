export default function OfflineSpeechStatus({ status, onRetry }) {
  const needsRetry = !['ready', 'preparing'].includes(status.status);
  return <details className="core-speech-status" data-testid="core-speech-status">
    <summary>{needsRetry ? '오프라인 음성 확인 필요' : '오프라인 음성 준비'}</summary>
    <p role="status">{status.status === 'preparing' ? '기본 긴급·복구 음성을 준비하고 있어요.'
      : status.status === 'ready' ? `기본 긴급·복구 음성 ${status.saved}개 저장됨`
        : status.ready ? `기본 긴급·복구 음성 ${status.saved}/${status.total}개 저장됨 · 현재 ${status.ready}개 재생 가능`
          : '기본 긴급·복구 음성을 저장하지 못했어요. 기기 음성은 계속 사용할 수 있어요.'}</p>
    {needsRetry && <button type="button" onClick={onRetry}>기본 음성 준비 다시 시도</button>}
  </details>;
}
