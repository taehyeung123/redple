import { api, fmtNum } from '../common/api.js';
import { getCachedUser, getApiKey, setCachedUser } from '../common/storage.js';
import { CATEGORY_GROUPS, CATEGORIES, findCategory } from '../common/categories.js';

const chromeApi = /** @type {any} */ (globalThis.chrome);
const $ = (id) => document.getElementById(id);

const DRAFT_MAGIC = '__redrank_draft__';

const state = {
    category: null,
    style: 'friendly',
    result: null,
};

// ── 구독 게이트 ─────────────────────────────────────────────

async function checkAccess() {
    const key = await getApiKey();
    if (!key) {
        showGate('레드랭크 계정을 먼저 연결해주세요. 확장 아이콘을 눌러 API 키를 입력하면 됩니다.', 'https://www.redrank.kr/profile', 'API 키 발급받기');
        return false;
    }

    let user = await getCachedUser();
    const res = await api.verify(key);
    if (res.ok && res.data?.user) {
        user = res.data.user;
        await setCachedUser(user);
    }

    if (!user) {
        showGate('계정 정보를 확인할 수 없습니다. 확장 아이콘에서 다시 연결해주세요.', 'https://www.redrank.kr/profile', 'API 키 재발급');
        return false;
    }

    $('coins').textContent = `${fmtNum(user.coins?.total ?? 0)} 코인`;

    if (user.plan === 'free') {
        showGate('AI 원고 생성은 레드랭크 구독자 전용 기능입니다. Basic 플랜부터 이용할 수 있습니다.', 'https://www.redrank.kr/pricing', '레드랭크 구독하기');
        return false;
    }

    return true;
}

function showGate(msg, href, label) {
    $('form').classList.add('hidden');
    $('gate-msg').textContent = msg;
    const link = $('gate-link');
    link.href = href;
    link.textContent = label;
    $('gate').classList.remove('hidden');
}

// ── 카테고리 UI ─────────────────────────────────────────────

function renderCategories() {
    const wrap = $('cat-groups');
    wrap.innerHTML = CATEGORY_GROUPS.map((g) => {
        const items = CATEGORIES.filter((c) => c.group === g.group);
        return `
          <div class="cat-group">
            <div class="cat-group-name"><b>${g.group}</b><small>${g.hint}</small></div>
            <div class="cat-list">
              ${items.map((c) => `<button class="cat" data-id="${c.id}">${c.label}</button>`).join('')}
            </div>
          </div>`;
    }).join('');

    wrap.querySelectorAll('.cat').forEach((btn) => {
        btn.addEventListener('click', () => selectCategory(btn.dataset.id));
    });
}

function selectCategory(id) {
    state.category = id;
    document.querySelectorAll('.cat').forEach((b) => {
        b.classList.toggle('cat-on', b.dataset.id === id);
    });

    const cat = findCategory(id);
    $('cat-desc').textContent = cat?.description || '';

    // 원본 자료 섹션
    if (cat?.requiresSource) {
        $('source-label').textContent = cat.sourceLabel || '원본 자료';
        $('source').placeholder = `${cat.sourceLabel || '원본 자료'}를 붙여넣어 주세요`;
        $('sec-source').classList.remove('hidden');
    } else {
        $('sec-source').classList.add('hidden');
    }

    // 경험 필수 여부
    const expReq = $('exp-req');
    if (cat?.experienceRequired) {
        expReq.textContent = '필수';
        expReq.className = 'req';
    } else {
        expReq.textContent = '선택';
        expReq.className = 'opt';
    }
}

// ── 키워드 조회 ─────────────────────────────────────────────

$('kw-check').addEventListener('click', async () => {
    const kw = $('main-kw').value.trim();
    if (!kw) return;

    const box = $('kw-info');
    box.innerHTML = '<div class="kw-line"><span>조회 중…</span></div>';

    const res = await api.keyword(kw);
    if (!res.ok) {
        box.innerHTML = `<div class="kw-line"><span class="kw-bad">${res.error || '조회 실패'}</span></div>`;
        return;
    }

    const d = res.data || {};
    const ratio = Number(d.competitionRatio);
    const verdict = d.isGolden
        ? '<b class="kw-good">황금 키워드</b>'
        : ratio < 5 ? '<b class="kw-good">경쟁 낮음</b>'
        : ratio < 20 ? '<b>경쟁 보통</b>'
        : '<b class="kw-bad">경쟁 높음</b>';

    box.innerHTML = `
      <div class="kw-line"><span>월간 검색량</span><b>${fmtNum(d.monthlySearch)}</b></div>
      <div class="kw-line"><span>블로그 문서수</span><b>${fmtNum(d.docCount)}</b></div>
      <div class="kw-line"><span>경쟁률</span>${verdict}</div>`;
});

// ── 폼 인터랙션 ─────────────────────────────────────────────

document.querySelectorAll('.style').forEach((btn) => {
    btn.addEventListener('click', () => {
        state.style = btn.dataset.style;
        document.querySelectorAll('.style').forEach((b) => b.classList.toggle('style-on', b === btn));
    });
});

$('length').addEventListener('input', (e) => {
    $('len-val').textContent = Number(e.target.value).toLocaleString('ko-KR') + '자';
});

// ── 생성 ────────────────────────────────────────────────────

function toast(msg, kind = 'err') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast toast-${kind}`;
    setTimeout(() => t.classList.add('hidden'), 4000);
}

$('go').addEventListener('click', async () => {
    const mainKeyword = $('main-kw').value.trim();
    if (!mainKeyword) { toast('메인 키워드를 입력해주세요'); return; }

    const cat = findCategory(state.category);
    const sourceContent = $('source').value.trim();
    const experience = $('experience').value.trim();

    if (cat?.requiresSource && !sourceContent) {
        toast(`${cat.sourceLabel || '원본 자료'}을(를) 입력해주세요`);
        return;
    }
    // 카테고리 미선택이거나 경험 필수 카테고리면 경험이 반드시 필요 (레드랭크 API 규칙과 동일)
    if ((!cat || cat.experienceRequired) && !experience) {
        toast('나의 경험/의견을 입력해주세요');
        return;
    }

    const body = {
        mainKeyword,
        subKeywords: $('sub-kw').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
        experience,
        style: state.style,
        useEmoji: $('emoji').checked,
        targetLength: Number($('length').value),
        additionalRequest: $('extra').value.trim(),
    };
    if (state.category) body.category = state.category;
    if (cat?.requiresSource) body.sourceContent = sourceContent;

    $('loading').classList.remove('hidden');
    const res = await api.generate(body);
    $('loading').classList.add('hidden');

    if (!res.ok) {
        toast(res.needLogin
            ? '레드랭크에 로그인한 뒤 다시 시도해주세요 (redrank.kr 탭에서 로그인)'
            : (res.error || '원고 생성에 실패했습니다'));
        return;
    }

    state.result = res.data;
    renderResult(res.data);
    checkAccess(); // 코인 잔액 갱신
});

function renderResult(r) {
    $('form').classList.add('hidden');
    $('result').classList.remove('hidden');

    $('r-title').textContent = r.title || '';
    $('r-body').textContent = r.content || '';
    $('r-len').textContent = `${(r.content || '').replace(/\s/g, '').length.toLocaleString('ko-KR')}자 (공백제외)`;

    const tags = Array.isArray(r.hashtags) ? r.hashtags : [];
    $('r-tags').innerHTML = tags.map((t) => `<span>#${String(t).replace(/^#/, '')}</span>`).join('');

    $('r-seo').textContent = r.seoTips || '';

    document.body.scrollTop = 0;
}

$('back').addEventListener('click', () => {
    $('result').classList.add('hidden');
    $('form').classList.remove('hidden');
});

// ── 에디터로 보내기 ─────────────────────────────────────────

$('send-editor').addEventListener('click', async () => {
    const r = state.result;
    if (!r) return;

    const payload = {
        [DRAFT_MAGIC]: 1,
        v: 1,
        title: (r.title || '').trim(),
        body: (r.content || '').trim(),
        tags: (Array.isArray(r.hashtags) ? r.hashtags : [])
            .map((t) => String(t).replace(/^#/, '').trim())
            .filter(Boolean)
            .slice(0, 30),
        images: [],
        ts: Date.now(),
    };

    try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
        toast('복사됐습니다. 네이버 블로그 글쓰기 화면에서 "레드랭크 원고 불러오기"를 눌러주세요', 'ok');
    } catch {
        toast('클립보드 복사에 실패했습니다. "본문만 복사"를 이용해주세요');
    }
});

$('copy-body').addEventListener('click', async () => {
    const r = state.result;
    if (!r) return;
    try {
        await navigator.clipboard.writeText(r.content || '');
        toast('본문을 복사했습니다', 'ok');
    } catch {
        toast('클립보드 복사에 실패했습니다');
    }
});

// ── 부트 ────────────────────────────────────────────────────

async function boot() {
    renderCategories();
    selectCategory('info_post'); // 기본 선택

    const ok = await checkAccess();
    if (!ok) return;

    // 컨텍스트 메뉴로 넘어온 키워드 자동 반영
    const { pendingKeyword, pendingKeywordTs } = await chromeApi.storage.local.get(['pendingKeyword', 'pendingKeywordTs']);
    if (pendingKeyword && Date.now() - (pendingKeywordTs || 0) < 30000) {
        $('main-kw').value = pendingKeyword;
        $('kw-check').click();
        chromeApi.storage.local.remove(['pendingKeyword', 'pendingKeywordTs']);
    }
}

boot();
