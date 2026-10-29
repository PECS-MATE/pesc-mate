import { useEffect, useState } from 'react';
import UiIcon from './UiIcon';
import { request, requestBlob } from './services/api';
import pinkProfile from './assets/profiles/PF01_pink.png';
import orangeProfile from './assets/profiles/PF02_orange.png';
import skyProfile from './assets/profiles/PF03_sky.png';
import creamProfile from './assets/profiles/PF04_cream.png';
import greenProfile from './assets/profiles/PF05_green.png';
import blueProfile from './assets/profiles/PF06_blue.png';
import spaceProfile from './assets/profiles/PF07_space.png';

const PRESET_IMAGES = {
  pink: pinkProfile, orange: orangeProfile, sky: skyProfile, cream: creamProfile,
  green: greenProfile, blue: blueProfile, space: spaceProfile,
};

export function Avatar({ user }) {
  const [image, setImage] = useState(null);
  const url = user?.profile?.thumbnail_url || user?.profile?.image_url;
  useEffect(() => {
    let active = true;
    let objectUrl;
    setImage(null);
    if (url) requestBlob(url).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ url, src: objectUrl });
    }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  const presetImage = PRESET_IMAGES[user?.profile?.preset] || pinkProfile;
  return <span className="profile-avatar" role="img" aria-label={`${user?.name || '사용자'} 프로필`}>
    {image?.url === url && image ? <img src={image.src} alt="" />
      : <img src={presetImage} alt="" />}
  </span>;
}

export function ProfileEditor({ user, onSaved, onCancel }) {
  const [presets, setPresets] = useState([]);
  const [preset, setPreset] = useState(user.profile?.preset || '');
  const [custom, setCustom] = useState(user.profile?.kind === 'custom');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    request('/profile/presets').then(items => {
      if (!active) return;
      setPresets(items);
      setPreset(current => items.some(item => item.id === current) ? current : '');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      let profile;
      if (custom) {
        const body = new FormData(); body.append('image', file);
        profile = await request('/profile/image', { method: 'POST', body });
      } else {
        profile = await request('/profile', { method: 'PUT', body: JSON.stringify({ preset }) });
      }
      onSaved({ ...user, profile });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="profile-editor" aria-labelledby="profile-title">
    <h2 id="profile-title">{user.profile ? '프로필 설정' : '처음 사용할 프로필을 골라 주세요'}</h2>
    <p>좋아하는 색의 PESC MATE 캐릭터 또는 직접 등록한 사진을 사용할 수 있어요.</p>
    <form onSubmit={save}>
      <fieldset disabled={busy}><legend>프로필 이미지 선택</legend>
        <div className="profile-options">{presets.map(item => <label key={item.id} className={(!custom && preset === item.id) ? 'selected' : ''}>
          <input type="radio" name="profile" checked={!custom && preset === item.id} onChange={() => { setPreset(item.id); setCustom(false); }} />
          <img className="profile-preset-image" src={PRESET_IMAGES[item.id]} alt="" />{item.label}
        </label>)}
        <label className={custom ? 'selected' : ''}><input type="radio" name="profile" checked={custom} onChange={() => setCustom(true)} /><span className="profile-upload-mark" aria-hidden="true"><UiIcon name="plus" size={28} /></span>직접 등록</label></div>
        {custom && <div className="profile-upload"><label>사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const chosen = event.target.files?.[0]; setError(''); setFile(null);
          if (!chosen) return;
          if (!['image/jpeg','image/png','image/webp'].includes(chosen.type) || chosen.size > 5*1024*1024) {
            setError('JPG, PNG, WebP 형식의 5MB 이하 이미지를 선택해 주세요.'); event.target.value = ''; return;
          }
          setFile(chosen);
        }} /></label><p>JPG·PNG·WebP, 5MB 이하, 가로·세로 128~4096px (총 1600만 픽셀 이하). 안전성 검사를 통과한 사진만 저장됩니다. 검사 서비스를 사용할 수 없으면 기본 캐릭터를 선택해 주세요.</p>
        <p>원본은 로컬 DB에 보관하며 촬영 위치·기기 정보가 남을 수 있습니다. 화면에는 메타데이터를 제거한 축소 이미지만 사용합니다.</p>
        {preview && <img className="profile-preview" src={preview} alt="선택한 프로필 미리 보기" />}</div>}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      {!presets.length && <button type="button" disabled={busy} onClick={() => setRetry(value => value + 1)}>선택 목록 다시 불러오기</button>}
      <div className="profile-actions"><button className="primary" disabled={busy || (custom ? !file : !preset)}>{busy ? '저장 중…' : '프로필 저장'}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel}>{user.profile ? '닫기' : '로그아웃'}</button>}</div>
    </form>
  </section>;
}
