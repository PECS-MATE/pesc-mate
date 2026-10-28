import Mascot from './Mascot';

const features = [
  { icon: '▦', title: '그림으로 말하기', text: '익숙한 그림카드를 골라 순서대로 담고, 확인한 문장을 음성으로 전해요.', tone: 'speaking' },
  { icon: '★', title: '차근차근 연습하기', text: '그림과 단어를 연결하고, 소리를 듣고 찾고, 카드로 문장 순서를 익혀요.', tone: 'practice' },
  { icon: '▤', title: '실물 카드 연결', text: 'PC에 연결한 리더기로 카드를 읽고, 화면에서 확인한 뒤 문장에 담아요.', tone: 'reader' },
];

export default function LandingPage({ children, previewCards = [], onLogin, onStart, busy = false, pageRef }) {
  function authenticate(event, action) {
    event.preventDefault();
    if (!busy) action();
  }

  return <main ref={pageRef} className="landing" id="landing-top">
    <a className="skip-link" href="#landing-account">로그인·가입으로 바로가기</a>
    <header className="landing-header"><div className="landing-container landing-header-inner">
      <a className="landing-brand" href="#landing-top" aria-label="PESC MATE 소개 처음으로"><Mascot /><span>PESC <b>MATE</b></span></a>
      <nav aria-label="서비스 소개"><a href="#landing-features">주요 기능</a><a href="#landing-how">이용 방법</a><a href="#landing-faq">자주 묻는 질문</a></nav>
      <div className="landing-header-actions"><a href="#landing-account" onClick={event => authenticate(event, onLogin)} aria-disabled={busy}>로그인</a>
        <a className="landing-cta" href="#landing-account" onClick={event => authenticate(event, onStart)} aria-disabled={busy}>시작하기 <span aria-hidden="true">→</span></a></div>
    </div></header>

    <section className="landing-hero landing-container" aria-labelledby="landing-title">
      <div className="landing-hero-copy"><p className="landing-eyebrow">그림으로 전하는 나의 이야기</p>
        <h1 id="landing-title">그림을 고르고,<br /><em>마음을 전해요.</em></h1>
        <p className="landing-lead">말로 표현하기 어려운 순간에도,<br />익숙한 카드 한 장에서 소통을 시작해 보세요.</p>
        <p className="landing-description">PESC MATE는 그림카드와 음성으로 의사를 표현하고,<br className="landing-wide-only" /> 나에게 맞는 속도로 연습하는 AAC 도구입니다.</p>
        <div className="landing-hero-actions"><a className="landing-cta" href="#landing-account" onClick={event => authenticate(event, onStart)} aria-disabled={busy}>나의 소통 공간 만들기 <span aria-hidden="true">→</span></a>
          <a className="landing-text-link" href="#landing-how">어떻게 사용하나요? <span aria-hidden="true">↓</span></a></div>
        <p className="landing-hero-note">화면 터치로 시작하고 · 필요할 때 실물 카드를 연결해요</p>
      </div>
      <figure className="landing-preview" aria-label="그림카드를 조합해 말하는 사용 예시">
        <figcaption><span className="landing-preview-dot" aria-hidden="true" />카드로 만드는 한 문장 <small>사용 예시</small></figcaption>
        <div className="landing-preview-cards">{previewCards.map((card, index) => <div key={card.id} className="landing-preview-card">
          <span className="landing-card-order" aria-hidden="true">{index + 1}</span>
          {card.image ? <img src={card.image} alt="" loading="lazy" decoding="async" fetchPriority="low" width="112" height="112" /> : <span className="landing-card-fallback" aria-hidden="true">{card.symbol || '▦'}</span>}
          <strong>{card.label}</strong>
        </div>)}</div>
        <div className="landing-preview-sentence"><span aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></svg></span><div><small>고른 카드로 전하는 마음</small><p>나는 물을 마시고 싶어요.</p></div></div>
        <div className="landing-preview-helper"><img className="landing-brand-illustration" src="/pecs-mate.png"
          alt="하트 카드와 물 카드를 든 PESC MATE 캐릭터" width="100" height="86" decoding="async" />
          <p>고르고, 확인하고, 말하기.<br /><strong>내가 전하고 싶은 마음 그대로.</strong></p></div>
      </figure>
    </section>

    <section className="landing-features" id="landing-features" aria-labelledby="landing-features-title"><div className="landing-container">
      <div className="landing-section-heading"><p className="landing-eyebrow">나에게 맞는 소통 방법</p><h2 id="landing-features-title">그림에서 시작해, 소통과 연습으로</h2><p>말하기와 연습하기를 오가며 익숙한 표현을 하나씩 만나 보세요.</p></div>
      <div className="landing-feature-grid">{features.map(feature => <article key={feature.tone} className={`landing-feature ${feature.tone}`}>
        <span className="landing-feature-icon" aria-hidden="true">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.text}</p>
      </article>)}</div>
    </div></section>

    <section className="landing-how landing-container" id="landing-how" aria-labelledby="landing-how-title">
      <div className="landing-section-heading"><p className="landing-eyebrow">처음이어도 차근차근</p><h2 id="landing-how-title">세 단계로 시작하는 나의 이야기</h2></div>
      <ol className="landing-steps"><li><span aria-hidden="true">01</span><h3>나의 공간을 준비해요</h3><p>로그인하고 좋아하는 프로필을 골라요. 홈에서 말하기와 연습하기를 시작할 수 있어요.</p></li>
        <li><span aria-hidden="true">02</span><h3>전하고 싶은 카드를 골라요</h3><p>화면의 그림을 누르거나, 연결한 리더기로 실물 카드를 읽고 문장에 담아요.</p></li>
        <li><span aria-hidden="true">03</span><h3>확인한 마음을 말해요</h3><p>카드 순서와 내용을 확인하고 말하기 버튼을 눌러요. 잘못 고른 카드는 다시 바꿀 수 있어요.</p></li></ol>
      <aside className="landing-care-note"><span aria-hidden="true">♡</span><div><h3>보호자와 담당자도 함께해요</h3><p>연결된 사용자의 카드·학습·음성 설정을 허용된 권한 안에서 지원할 수 있어요. 개인정보 동의와 기록 관리는 마이페이지에서 확인해요.</p></div></aside>
    </section>

    <section className="landing-faq landing-container" id="landing-faq" aria-labelledby="landing-faq-title"><div className="landing-section-heading"><p className="landing-eyebrow">시작하기 전에</p><h2 id="landing-faq-title">자주 묻는 질문</h2></div>
      <div className="landing-faq-list">
        <details><summary>카드 리더기가 꼭 필요한가요?</summary><p>화면에서 그림카드를 선택해 말하기와 연습하기를 사용할 수 있어요. 실물 카드 연결은 추가로 선택하는 방식이에요.</p></details>
        <details><summary>어떤 기기에서 사용할 수 있나요?</summary><p>PC와 태블릿 브라우저에서 화면 카드를 사용할 수 있어요. USB 리더기는 Windows PC의 Chrome·Edge에서 먼저 사용해 주세요. 브라우저에서 USB 연결 버튼을 눌러 포트를 선택해야 해요.</p></details>
        <details><summary>인터넷이 없어도 말할 수 있나요?</summary><p>온라인에서 카드와 기본 음성을 미리 준비한 기기에서는 저장된 카드와 음성을 사용할 수 있어요. 기기의 한국어 음성 지원과 사전 준비 상태를 확인해 주세요. 자연스러운 문장 생성과 새로운 데이터 조회에는 서버 연결이 필요해요.</p></details>
        <details><summary>개인정보와 기록은 어디에서 관리하나요?</summary><p>로그인 후 이름이나 프로필 사진을 눌러 마이페이지를 열고 보호자 설정을 선택해 주세요. 동의·보존 기간과 연결된 지원자의 권한을 관리할 수 있어요. 동의가 없을 때도 기본 말하기와 기록 없는 연습은 유지돼요.</p></details>
      </div>
    </section>

    <section className="landing-account" id="landing-account" aria-labelledby="landing-account-title"><div className="landing-container landing-account-inner">
      <div><p className="landing-eyebrow">나의 이야기를 시작할 시간</p><h2 id="landing-account-title">작은 선택이<br /><em>나의 목소리가 되도록.</em></h2><p>나에게 익숙한 그림으로 마음을 전하고,<br />보호자와 함께 소통 환경을 만들어 가세요.</p><img className="landing-account-mascot" src="/pecs-mate.png" alt="" aria-hidden="true" width="180" height="155" loading="lazy" decoding="async" /></div>
      {children}
    </div></section>
    <footer className="landing-footer landing-container"><a className="landing-brand" href="#landing-top">PESC <b>MATE</b></a><p>그림으로 마음을 전하는 AAC 프로젝트</p><a href="#landing-top">맨 위로 ↑</a></footer>
  </main>;
}
