import { api, PLAN_META, fmtNum } from '../common/api.js';
import { getApiKey, setApiKey, getCachedUser, setCachedUser } from '../common/storage.js';

const chromeApi = /** @type {any} */ (globalThis.chrome);
const $ = (id) => document.getElementById(id);

// ── 계정 ────────────────────────────────────────────────────

function showLoggedIn(user) {
    $('account-loading').classList.add('hidden');
    $('account-out').classList.add('hidden');
    $('account-in').classList.remove('hidden');

    $('user-name').textContent = user.displayName || '사용자';

    const meta = PLAN_META[user.plan] || PLAN_META.free;
    const badge = $('user-plan');
    badge.textContent = meta.label;
    badge.style.background = meta.color;

    $('user-coins').textContent = fmtNum(user.coins?.total ?? 0);

    // 레드플은 구독자 전용 — 무료 플랜은 안내
    const notice = $('plan-notice');
    if (user.plan === 'free') {
        notice.textContent = '무료 플랜은 키워드 조회만 이용할 수 있습니다. AI 원고 생성·법적 검사는 Basic 이상 구독 시 사용 가능합니다.';
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
}

function showLoggedOut() {
    $('account-loading').classList.add('hidden');
    $('account-in').classList.add('hidden');
    $('account-out').classList.remove('hidden');
}

async function loadAccount() {
    // 캐시 먼저 보여주고 백그라운드에서 갱신 (팝업 체감속도)
    const cached = await getCachedUser();
    if (cached) showLoggedIn(cached);

    const key = await getApiKey();
    if (!key) { showLoggedOut(); return; }

    const res = await api.verify(key);
    if (res.ok && res.data?.user) {
        await setCachedUser(res.data.user);
        showLoggedIn(res.data.user);
    } else {
        await setCachedUser(null);
        showLoggedOut();
    }
}

$('key-save').addEventListener('click', async () => {
    const key = $('key-input').value.trim();
    if (!key) return;

    const btn = $('key-save');
    btn.disabled = true;
    btn.textContent = '연결 중…';

    const res = await api.verify(key);
    if (res.ok && res.data?.user) {
        await setApiKey(key);
        await setCachedUser(res.data.user);
        showLoggedIn(res.data.user);
    } else {
        btn.textContent = '연결 실패 — 키를 확인해주세요';
        setTimeout(() => { btn.textContent = '연결하기'; btn.disabled = false; }, 2000);
        return;
    }
    btn.disabled = false;
    btn.textContent = '연결하기';
});

$('key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('key-save').click();
});

// ── 키워드 조회 ─────────────────────────────────────────────

function badgeFor(d) {
    if (d.isGolden) return '<span class="kw-badge kw-gold">황금 키워드</span>';
    const r = Number(d.competitionRatio);
    if (isNaN(r)) return '';
    if (r < 5) return '<span class="kw-badge kw-green">경쟁 낮음</span>';
    if (r < 20) return '<span class="kw-badge kw-green">경쟁 보통</span>';
    return '<span class="kw-badge kw-red">경쟁 높음</span>';
}

async function lookupKeyword() {
    const kw = $('kw-input').value.trim();
    if (!kw) return;

    const box = $('kw-result');
    box.innerHTML = '<div class="loading">조회 중…</div>';

    const res = await api.keyword(kw);
    if (!res.ok) {
        box.innerHTML = `<div class="kw-error">${res.error || '조회 실패'}</div>`;
        return;
    }

    const d = res.data || {};
    box.innerHTML = `
      ${badgeFor(d)}
      <div class="kw-stats">
        <div class="kw-stat"><b>${fmtNum(d.monthlySearch)}</b><span>월간 검색량</span></div>
        <div class="kw-stat"><b>${fmtNum(d.docCount)}</b><span>블로그 문서수</span></div>
        <div class="kw-stat"><b>${d.competitionRatio ?? '-'}</b><span>경쟁률</span></div>
        <div class="kw-stat"><b>${fmtNum(d.pcSearch)}</b><span>PC</span></div>
        <div class="kw-stat"><b>${fmtNum(d.mobileSearch)}</b><span>모바일</span></div>
        <div class="kw-stat"><b>${d.saturation ?? '-'}%</b><span>포화도</span></div>
      </div>`;
}

$('kw-go').addEventListener('click', lookupKeyword);
$('kw-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupKeyword();
});

// ── 액션 ────────────────────────────────────────────────────

$('open-panel').addEventListener('click', async () => {
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
        await chromeApi.sidePanel.open({ tabId: tab.id });
        window.close();
    }
});

$('open-options').addEventListener('click', () => {
    chromeApi.runtime.openOptionsPage();
});

// ── 부트 ────────────────────────────────────────────────────

$('ver').textContent = 'v' + chromeApi.runtime.getManifest().version;
loadAccount();

// 컨텍스트 메뉴로 넘어온 키워드 자동 조회
chromeApi.storage.local.get(['pendingKeyword', 'pendingKeywordTs']).then(({ pendingKeyword, pendingKeywordTs }) => {
    if (pendingKeyword && Date.now() - (pendingKeywordTs || 0) < 30000) {
        $('kw-input').value = pendingKeyword;
        lookupKeyword();
        chromeApi.storage.local.remove(['pendingKeyword', 'pendingKeywordTs']);
    }
});
