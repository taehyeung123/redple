import { api, fmtNum } from '../common/api.js';
import { getCachedUser, getApiKey, setCachedUser } from '../common/storage.js';
import { CATEGORY_GROUPS, CATEGORIES, findCategory } from '../common/categories.js';
import { markdownToPlainText } from '../common/markdown.js';

const chromeApi = /** @type {any} */ (globalThis.chrome);
const $ = (id) => document.getElementById(id);

const DRAFT_MAGIC = '__redrank_draft__';

const state = {
    category: null,
    style: 'friendly',
    imageCount: 0,
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

/** 프로필에 등록된 말투 샘플이 있으면 문체 그룹의 "내 말투로" 버튼을 활성화한다 */
async function checkToneSample() {
    const res = await api.profile();
    const hasTone = !!(res.ok && res.data?.profile?.toneSampleUrl);
    const toneBtn = document.querySelector('.style[data-style="mytone"]');
    toneBtn.disabled = !hasTone;
    $('tone-setup-hint').classList.toggle('hidden', hasTone);
    // 등록 전에 이미 "내 말투로"가 선택돼 있었을 리는 없지만, 방어적으로 기본 문체로 되돌린다
    if (!hasTone && state.style === 'mytone') {
        state.style = 'friendly';
        document.querySelectorAll('.style').forEach((b) => b.classList.toggle('style-on', b.dataset.style === 'friendly'));
    }
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

function updateGoCostHint() {
    const imgCost = state.imageCount * 10;
    $('go-cost-hint').textContent = imgCost > 0
        ? `생성 1코인 + 이미지 ${state.imageCount}장(${imgCost}코인) = 총 ${1 + imgCost}코인이 차감됩니다`
        : '생성 1회당 1코인이 차감됩니다';
}

$('img-count').addEventListener('input', (e) => {
    state.imageCount = Number(e.target.value) || 0;
    $('img-count-val').textContent = state.imageCount > 0 ? `${state.imageCount}장` : '안 함';
    updateGoCostHint();
});

// ── 생성 ────────────────────────────────────────────────────

function toast(msg, kind = 'err') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast toast-${kind}`;
    setTimeout(() => t.classList.add('hidden'), 4000);
}

/**
 * 이미지 프롬프트를 요청 개수만큼 만든다. 대표 이미지 1장(제목 기준) + 소제목(outline)마다
 * 1장씩 — 같은 장면을 반복 생성하지 않고, 실제 본문 구성과 어울리는 서로 다른 사진이 나오게 한다.
 * outline이 짧아 count보다 프롬프트가 모자라면 처음부터 다시 순환한다.
 */
function buildImagePrompts(result, mainKeyword, count) {
    const sections = Array.isArray(result.outline) ? result.outline.filter(Boolean) : [];
    const base = [
        `${mainKeyword}, 글 전체를 대표하는 인상적인 대표 사진`,
        ...sections.map((s) => `${mainKeyword} 중에서도 "${s}" 부분을 구체적으로 보여주는 사진`),
    ];
    const prompts = [];
    for (let i = 0; i < count; i++) prompts.push(base[i % base.length]);
    return prompts;
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 본문 + 사진을 한 번에 클립보드로 옮기기 위한 HTML을 만든다. 소제목(outline)마다 이미지를
 * buildImagePrompts와 같은 순서로 매칭했으니(images[0]=대표, images[1+]=outline[i]), 여기서도
 * 그 소제목 문단을 만나는 지점 바로 뒤에 해당 이미지를 끼워 넣어 "제자리"에 오게 한다.
 * outline 텍스트가 본문 문단과 정확히 일치하지 않는 경우(AI가 약간 다르게 썼을 때)엔 매칭이
 * 안 될 수 있어 — 그럴 땐 그 섹션 이미지를 못 끼워 넣고 건너뛴다(전체 실패로 이어지진 않음).
 */
function buildBodyHtmlWithImages(content, outline, images) {
    const paras = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const sections = Array.isArray(outline) ? outline.filter(Boolean) : [];
    const sectionImages = images.slice(1); // images[0]은 대표 이미지

    let html = images[0] ? `<p><img src="${images[0].dataUrl}" alt="" style="max-width:100%"></p>` : '';
    for (const p of paras) {
        html += `<p>${escHtml(p)}</p>`;
        const secIdx = sections.findIndex((h) => p === h || p.startsWith(h) || h.startsWith(p));
        if (secIdx !== -1 && sectionImages[secIdx]) {
            html += `<p><img src="${sectionImages[secIdx].dataUrl}" alt="" style="max-width:100%"></p>`;
        }
    }
    return html;
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

    const useToneSample = state.style === 'mytone';
    const body = {
        mainKeyword,
        subKeywords: $('sub-kw').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
        experience,
        // "내 말투로"는 문체 프리셋이 아니라 별도 지시라, 서버에는 기본 문체(친근하게)를
        // 같이 보내고 useToneSample로 말투 샘플을 우선 적용하게 한다.
        style: useToneSample ? 'friendly' : state.style,
        useEmoji: $('emoji').checked,
        targetLength: Number($('length').value),
        additionalRequest: $('extra').value.trim(),
        useToneSample,
    };
    if (state.category) body.category = state.category;
    if (cat?.requiresSource) body.sourceContent = sourceContent;

    $('loading').classList.remove('hidden');
    $('loading').querySelector('p').textContent = 'AI가 원고를 쓰고 있습니다…';
    const res = await api.generate(body);

    if (!res.ok) {
        $('loading').classList.add('hidden');
        toast(res.needKey || res.needLogin
            ? '레드랭크 계정 연결이 만료됐습니다. 확장 아이콘에서 API 키를 다시 연결해주세요'
            : (res.error || '원고 생성에 실패했습니다'));
        return;
    }

    // 레드랭크 원고는 ##/** 같은 마크다운 기호로 오는데, 네이버 에디터는 마크다운을
    // 해석하지 않아 그대로 두면 기호가 그대로 노출된다 — 여기서 한 번만 정리해두고
    // 화면 표시·에디터 전송 모두 이 정리된 텍스트를 쓴다.
    state.result = {
        ...res.data,
        title: markdownToPlainText(res.data.title || ''),
        content: markdownToPlainText(res.data.content || ''),
        images: [],
    };

    // 이미지도 함께 요청했으면 원고 생성 직후 이어서 만든다 — "원고+사진 한 번에".
    // 같은 프롬프트를 count장 반복 생성하면 서로 비슷한 사진만 나오므로, 본문 소제목(outline)
    // 하나마다 별도 프롬프트로 한 장씩 생성해 실제 내용과 어울리는 다양한 사진을 만든다.
    if (state.imageCount > 0) {
        $('loading').querySelector('p').textContent = `이미지 ${state.imageCount}장을 만들고 있습니다…`;
        const prompts = buildImagePrompts(state.result, mainKeyword, state.imageCount);
        const results = await Promise.all(
            prompts.map((prompt) => api.generateImage({ prompt, style: 'realistic', size: 'blog', count: 1 }))
        );

        const images = [];
        let failCount = 0;
        let firstError = '';
        for (const r of results) {
            const im = r.ok ? r.data?.images?.[0] : null;
            if (im) {
                images.push({ dataUrl: `data:${im.mimeType || 'image/png'};base64,${im.image}` });
            } else {
                failCount++;
                if (!firstError) {
                    firstError = r.needKey || r.needLogin ? '레드랭크 계정 연결이 만료됐습니다' : (r.error || '');
                }
            }
        }
        state.result.images = images;

        if (images.length === 0) {
            toast(`이미지 생성에 실패했습니다${firstError ? ' — ' + firstError : ''}. 원고는 정상적으로 만들어졌습니다.`, 'warn');
        } else if (failCount > 0) {
            toast(`이미지 ${images.length}장 생성 완료 (${failCount}장 실패${firstError ? ': ' + firstError : ''})`, 'warn');
        }
    }

    $('loading').classList.add('hidden');
    renderResult(state.result);
    checkAccess(); // 코인 잔액 갱신

    // 이미 네이버 블로그 글쓰기 탭을 보고 있었다면, 버튼을 누르지 않아도 바로 채워본다
    // (실패해도 조용히 넘어간다 — 아래 "네이버 에디터로 보내기" 버튼이 항상 재시도 수단으로 남아있음)
    sendDraftToEditor(state.result, { auto: true });
});

function renderResult(r) {
    $('form').classList.add('hidden');
    $('result').classList.remove('hidden');

    $('r-title').textContent = r.title || '';
    $('r-body').textContent = r.content || '';
    $('r-len').textContent = `${(r.content || '').replace(/\s/g, '').length.toLocaleString('ko-KR')}자 (공백제외)`;

    const images = Array.isArray(r.images) ? r.images : [];
    $('r-images-title').classList.toggle('hidden', images.length === 0);
    $('r-images-hint').classList.toggle('hidden', images.length === 0);
    $('copy-body-images').classList.toggle('hidden', images.length === 0);
    $('copy-body-images-hint').classList.toggle('hidden', images.length === 0);
    $('r-images').innerHTML = images.map((im, i) => `
      <div class="r-image-item">
        <img src="${im.dataUrl}" alt="생성된 이미지 ${i + 1}">
        <button class="r-image-copy" data-idx="${i}" title="이 사진을 클립보드에 복사">복사</button>
      </div>`).join('');
    $('r-images').querySelectorAll('.r-image-copy').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const im = images[Number(btn.dataset.idx)];
            if (!im) return;
            try {
                const blob = await (await fetch(im.dataUrl)).blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                toast('사진을 클립보드에 복사했습니다 — 에디터에서 원하는 위치를 클릭하고 Ctrl+V 해주세요', 'ok');
            } catch {
                toast('사진 복사에 실패했습니다', 'err');
            }
        });
    });

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

/** 지금 활성 탭이 네이버 블로그 글쓰기 화면이면, 클립보드를 거치지 않고 바로 채워넣는다. */
function sendToActiveTab(draft) {
    return new Promise((resolve) => {
        chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs?.[0];
            if (!tab?.id) { resolve({ ok: false, error: 'no-active-tab' }); return; }
            chromeApi.tabs.sendMessage(tab.id, { cmd: 'redple.applyDraft', draft }, (res) => {
                if (chromeApi.runtime.lastError) {
                    resolve({ ok: false, error: chromeApi.runtime.lastError.message });
                    return;
                }
                resolve(res || { ok: false, error: '응답 없음' });
            });
        });
    });
}

/**
 * 원고를 지금 활성 탭(네이버 블로그 글쓰기 화면)에 적용한다.
 * opts.auto: 원고 생성 직후 버튼 클릭 없이 자동으로 시도하는 경우. 이땐 이 클릭에서 비롯된
 * 제스처가 없어(20~40초짜리 생성 대기를 거쳤으므로) 클립보드 쓰기가 막힐 수 있어 시도하지
 * 않고, 실패해도 조용히 넘어간다 — "네이버 에디터로 보내기" 버튼이 항상 재시도 수단으로 남는다.
 */
async function sendDraftToEditor(r, opts = {}) {
    const { auto = false } = opts;
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
        images: Array.isArray(r.images) ? r.images : [],
        ts: Date.now(),
    };

    const direct = await sendToActiveTab(payload);

    if (direct.ok) {
        toast(`${(direct.applied || []).join(' · ') || '원고'} 자동 입력 완료!`, 'ok');
        return;
    }

    if (auto) return;

    // direct.error가 있으면 응답 자체가 안 온 것(다른 탭/에디터 준비 전) — 원본 JSON을 클립보드에
    // 남겨 그 화면에서 "다시 불러오기"로 재시도할 수 있게 한다.
    if (direct.error) {
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload));
            toast('네이버 블로그 글쓰기 화면이 아니라 클립보드에 복사했습니다. 그 화면에서 "레드랭크 원고 다시 불러오기"를 눌러주세요', 'ok');
        } catch {
            toast('클립보드 복사에 실패했습니다. "본문만 복사"를 이용해주세요');
        }
        return;
    }

    // 에디터 탭까지는 도달했지만 본문 자동입력이 실패한 경우 — "다시 불러오기"를 한 번 더
    // 누르게 하지 않고, 지금 클릭의 제스처로 바로 본문을 클립보드에 남긴다(한 단계로 줄임).
    const titleNote = direct.titleOk ? '제목은 채워졌습니다. ' : '';
    try {
        await navigator.clipboard.writeText(payload.body);
        toast(`${titleNote}본문 자동입력에 실패해 클립보드에 복사했습니다 — 본문 영역을 클릭하고 Ctrl+V 해주세요`, 'warn');
    } catch {
        toast(`${titleNote}본문 자동입력과 클립보드 복사 모두 실패했습니다. "본문만 복사" 버튼을 이용해주세요`, 'warn');
    }
}

$('send-editor').addEventListener('click', () => sendDraftToEditor(state.result, { auto: false }));

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

$('copy-body-images').addEventListener('click', async () => {
    const r = state.result;
    const images = Array.isArray(r?.images) ? r.images : [];
    if (!r || images.length === 0) return;
    try {
        const html = buildBodyHtmlWithImages(r.content || '', r.outline || [], images);
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([r.content || ''], { type: 'text/plain' }),
            }),
        ]);
        toast('본문+사진을 복사했습니다 — 본문 영역 클릭 후 Ctrl+V 해주세요 (에디터가 이미지 붙여넣기를 지원해야 사진도 함께 들어갑니다)', 'ok');
    } catch {
        toast('복사에 실패했습니다. 사진은 각 "복사" 버튼으로 하나씩 넣어주세요', 'err');
    }
});

// ── 부트 ────────────────────────────────────────────────────

async function boot() {
    renderCategories();
    selectCategory('info_post'); // 기본 선택

    const ok = await checkAccess();
    if (!ok) return;

    checkToneSample();

    // 컨텍스트 메뉴로 넘어온 키워드 자동 반영
    const { pendingKeyword, pendingKeywordTs } = await chromeApi.storage.local.get(['pendingKeyword', 'pendingKeywordTs']);
    if (pendingKeyword && Date.now() - (pendingKeywordTs || 0) < 30000) {
        $('main-kw').value = pendingKeyword;
        $('kw-check').click();
        chromeApi.storage.local.remove(['pendingKeyword', 'pendingKeywordTs']);
    }
}

boot();
