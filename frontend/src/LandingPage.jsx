import Mascot from './Mascot';
import UiIcon from './UiIcon';
import tagScene from './assets/main/태그이미지.png';
import aacScene from './assets/main/aac사용.png';

const features = [
  { icon: 'tag', title: '실물 카드 태그', text: '실물 카드를 태그해 화면으로 가져오세요. 읽은 카드를 확인하고, 전하고 싶은 문장에 담을 수 있어요.' },
  { icon: 'book', title: '나에게 맞는 연습', text: '그림과 단어를 연결하고, 소리를 듣고 찾고, 카드의 순서를 맞추며 익숙한 표현을 연습해요.' },
  { icon: 'message', title: '그림으로 말하기', text: '실물 카드가 없어도 괜찮아요. 화면의 그림카드를 눌러 문장을 담고, 말하기 버튼으로 마음을 전해요.' },
];

function SceneImage({ src, alt, caption, lazy = false }) {
  return <figure className="landing-scene"><img src={src} alt={alt} width="1448" height="1086" loading={lazy ? 'lazy' : 'eager'} decoding="async" /><figcaption>{caption}</figcaption></figure>;
}

export default function LandingPage({ children, onLogin, onStart, busy = false, pageRef }) {
  function authenticate(event, action) { event.preventDefault(); if (!busy) action(); }
  const start = event => authenticate(event, onStart);
  const login = event => authenticate(event, onLogin);
  return <main ref={pageRef} className="landing" id="landing-top">
    <a className="skip-link" href="#landing-account">로그인·가입으로 바로가기</a>
    <header className="landing-header"><div className="landing-container landing-header-inner">
      <a className="landing-brand" href="#landing-top" aria-label="PECS MATE 소개 처음으로"><Mascot /><span>PECS <b>MATE</b></span></a>
      <nav aria-label="서비스 소개"><a href="#landing-features">주요 기능</a><a href="#landing-how">이용 방법</a><a href="#landing-faq">자주 묻는 질문</a></nav>
      <div className="landing-header-actions"><a href="#landing-account" onClick={login} aria-disabled={busy}>로그인</a><a className="landing-cta" href="#landing-account" onClick={start} aria-disabled={busy}>시작하기 <UiIcon name="arrow-right" /></a></div>
    </div></header>

    <section className="landing-hero landing-container" aria-labelledby="landing-title">
      <div className="landing-hero-copy"><p className="landing-eyebrow">그림카드로 연결되는 나의 목소리</p>
        <h1 id="landing-title">카드를 태그하고,<br /><em>마음을 전해요.</em></h1>
        <p className="landing-lead">손으로 고른 카드 한 장이<br />내가 전하고 싶은 이야기가 되도록.</p>
        <p className="landing-description">PECS MATE는 실물 카드 태그와 화면의 그림카드로<br className="landing-wide-only" /> 의사를 표현하고 음성으로 전하는 AAC 도구입니다.</p>
        <div className="landing-hero-actions"><a className="landing-cta" href="#landing-account" onClick={start} aria-disabled={busy}>나의 소통 시작하기 <UiIcon name="arrow-right" /></a><a className="landing-text-link" href="#landing-how">이용 방법 보기 <UiIcon name="arrow-down" /></a></div>
        <p className="landing-hero-note">화면 터치로도 사용할 수 있어요. 실물 카드 태그는 선택 사항이에요.</p>
      </div>
      <SceneImage src={tagScene} alt="아이가 보호자와 함께 사과 그림카드를 기기에 태그하는 장면" caption="실물 카드 태그 사용 장면 예시" />
    </section>

    <section className="landing-features" id="landing-features" aria-labelledby="landing-features-title"><div className="landing-container">
      <div className="landing-section-heading"><p className="landing-eyebrow">카드에서 시작하는 소통</p><h2 id="landing-features-title">세 가지 방법으로 더 가까이</h2><p>카드를 태그하고, 그림을 고르고, 나의 속도로 연습해요.</p></div>
      <div className="landing-feature-grid">{features.map(feature => <article className="landing-feature" key={feature.title}><span className="landing-feature-icon" aria-hidden="true"><UiIcon name={feature.icon} size={26} /></span><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
    </div></section>

    <section className="landing-showcase" aria-labelledby="landing-showcase-title"><div className="landing-container landing-showcase-inner">
      <SceneImage src={aacScene} alt="아이가 보호자와 함께 태블릿의 그림카드를 선택해 소통하는 장면" caption="AAC 사용 장면 예시 · 실제 서비스 화면과 다를 수 있습니다." lazy />
      <div><p className="landing-eyebrow">내가 사용하는 화면에 맞게</p><h2 id="landing-showcase-title">큰 화면에서도,<br />작은 화면에서도 편안하게.</h2><p className="landing-description">PC와 태블릿, 작은 화면에서도 카드를 찾고 문장을 담을 수 있도록 화면 폭에 맞춰 배치가 달라져요.</p>
        <ul className="landing-benefits"><li><UiIcon name="check" />누르기 쉬운 카드와 버튼</li><li><UiIcon name="check" />화면 폭에 맞춰 조정되는 배치</li><li><UiIcon name="check" />별도 앱 설치 없이 브라우저에서 사용</li></ul>
        <p className="landing-device-note">카드 태그 연결은 지원되는 PC 브라우저에서 사용해 주세요. 터치 화면 사용과 연결 지원 범위는 다를 수 있어요.</p>
      </div>
    </div></section>

    <section className="landing-how landing-container" id="landing-how" aria-labelledby="landing-how-title">
      <div className="landing-section-heading"><p className="landing-eyebrow">처음이라도 차근차근</p><h2 id="landing-how-title">나의 이야기를 전하는 방법</h2></div>
      <ol className="landing-steps"><li><span aria-hidden="true">01</span><h3>카드를 골라요</h3><p>화면의 그림을 누르거나 실물 카드를 태그해, 전하고 싶은 카드를 찾아요.</p></li><li><span aria-hidden="true">02</span><h3>나의 문장에 담아요</h3><p>담은 그림을 확인하고, 옆으로 끌어 순서를 바꿔요. 잘못 고른 카드는 뺄 수 있어요.</p></li><li><span aria-hidden="true">03</span><h3>음성으로 전해요</h3><p>스피커로 고른 카드를 읽거나, 반짝이 버튼으로 문장을 만들어 바로 말해요.</p></li></ol>
      <p className="landing-care-note">보호자와 담당자는 연결된 사용자의 카드·연습·음성 설정을 허용된 권한 안에서 지원할 수 있어요.</p>
    </section>

    <section className="landing-invitation landing-container" aria-labelledby="landing-invitation-title"><div className="landing-invitation-panel"><p className="landing-eyebrow">작은 선택에서 시작하는 이야기</p><h2 id="landing-invitation-title">나의 마음을 전하는 첫걸음,<br />PECS MATE와 함께해요.</h2><p>나에게 익숙한 그림으로 소통하고,<br />보호자와 함께 나의 소통 환경을 만들어 가세요.</p><div className="landing-invitation-actions"><a className="landing-cta" href="#landing-account" onClick={start} aria-disabled={busy}>시작하기 <UiIcon name="arrow-right" /></a><a className="landing-text-link" href="#landing-faq">궁금한 점 확인하기 <UiIcon name="chevron-down" /></a></div></div></section>

    <section className="landing-faq landing-container" id="landing-faq" aria-labelledby="landing-faq-title"><div className="landing-section-heading"><h2 id="landing-faq-title">시작하기 전에 확인해 주세요</h2></div><div className="landing-faq-list">
      <details><summary>실물 카드가 꼭 필요한가요?</summary><p>아니요. 화면의 그림카드만으로 말하기와 연습하기를 사용할 수 있어요. 실물 카드 태그는 추가로 선택할 수 있는 방식이에요.</p></details>
      <details><summary>어떤 기기에서 사용할 수 있나요?</summary><p>PC·태블릿·휴대폰 브라우저에서 화면의 카드를 사용할 수 있어요. 카드 태그 연결은 현재 Windows PC의 Chrome·Edge에서 먼저 사용해 주세요. 모든 기기에서 동일한 연결을 지원하는 것은 아니에요.</p></details>
      <details><summary>인터넷이 없어도 사용할 수 있나요?</summary><p>미리 준비한 기기에서는 저장된 카드와 지원되는 음성을 사용할 수 있어요. 자연스러운 문장 생성과 새 데이터 조회에는 서버 연결이 필요하며, 기기의 한국어 음성 지원도 확인해야 해요.</p></details>
      <details><summary>개인정보와 기록은 어디에서 관리하나요?</summary><p>로그인 후 프로필을 눌러 설정을 열 수 있어요. 보호자 설정에서 동의·보존 기간·연결 권한을 확인해 주세요. 동의가 없을 때도 기본 말하기와 기록 없는 연습은 유지돼요.</p></details>
    </div></section>

    <section className="landing-account" id="landing-account" aria-labelledby="landing-account-title"><div className="landing-container landing-account-inner"><div><p className="landing-eyebrow">나의 소통 공간</p><h2 id="landing-account-title">지금 이야기를 시작해요.</h2><p>내 계정으로 로그인하거나,<br />새로운 소통 공간을 만들어 보세요.</p></div>{children}</div></section>
    <footer className="landing-footer"><div className="landing-container landing-footer-inner"><div><a className="landing-brand" href="#landing-top"><span>PECS <b>MATE</b></span></a><p>그림과 실물 카드로 마음을 전하는 AAC 프로젝트</p></div><nav aria-label="하단 안내"><a href="#landing-features">주요 기능</a><a href="#landing-how">이용 방법</a><a href="#landing-faq">자주 묻는 질문</a><a href="#landing-top">맨 위로 <UiIcon name="arrow-up" /></a></nav></div></footer>
  </main>;
}
