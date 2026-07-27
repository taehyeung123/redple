/**
 * 레드플 — 네이버 블로그 글쓰기 도우미 (blog.naver.com)
 *
 * 기능
 *  1) 레드랭크 원고 자동 입력 — 클립보드의 구조화 JSON(__redrank_draft__)을 읽어
 *     제목·본문·태그를 스마트에디터에 채운다. 이미지는 다운로드 → 클립보드 붙여넣기 시도.
 *  2) 실시간 카운터 — 글자수(공백 제외/포함), 이미지·동영상 개수
 *  3) 금지어/과장광고 표현 실시간 검출
 *  4) 법적 위험 검사 (의료/법률/식품/금융) — 레드랭크 API 호출
 *  5) 형태소 분석 — 상위 키워드 빈도 확인
 *  6) "작성 중인 글이 있습니다" 팝업 자동 닫기
 *
 * ⚠️ 스마트에디터 ONE의 DOM은 네이버가 예고 없이 바꾼다. 셀렉터는 전부 다단계 폴백으로
 *    구성하고, 자동 입력이 실패하면 반드시 "클립보드에 복사됨 → 직접 붙여넣기" 안내로
 *    떨어지게 한다(사용자가 작업을 잃지 않는 게 최우선).
 */
(() => {
    'use strict';

    const chromeApi = /** @type {any} */ (globalThis.chrome);
    const PANEL_ID = 'redple-editor-panel';
    const DRAFT_MAGIC = '__redrank_draft__';

    // ── 에디터 DOM 접근 (다단계 폴백) ───────────────────────────

    /** 제목 입력 영역 후보 */
    const TITLE_SELECTORS = [
        '.se-documentTitle .se-text-paragraph',
        '.se-section-documentTitle .se-text-paragraph',
        '.se-documentTitle [contenteditable="true"]',
        '.se_textarea[title*="제목"]',
        '#subject',
        'input[name="subject"]',
    ];

    /** 본문 입력 영역 후보 */
    const BODY_SELECTORS = [
        '.se-component.se-text .se-text-paragraph',
        '.se-main-container .se-text-paragraph',
        '.se-content [contenteditable="true"]',
        '#editorContainer [contenteditable="true"]',
        '.se_component_wrap [contenteditable="true"]',
    ];

    function findFirst(selectors, root = document) {
        for (const sel of selectors) {
            const el = root.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function getTitleEl() { return findFirst(TITLE_SELECTORS); }
    function getBodyEl() { return findFirst(BODY_SELECTORS); }

    /** 에디터가 이 프레임에 있는지 */
    function hasEditor() {
        return !!(getTitleEl() || getBodyEl() || document.querySelector('.se-main-container, #editorContainer'));
    }

    // ── 텍스트 삽입 ─────────────────────────────────────────────

    /**
     * contenteditable에 텍스트를 넣는다.
     * 실제 개발자 사례상 키 입력 시뮬레이션(send_keys)은 스마트에디터에서 잘 동작하지 않아,
     * 클립보드 paste 이벤트를 직접 디스패치하는 방식을 1순위로 쓴다.
     */
    function insertText(el, text) {
        if (!el) return false;
        try {
            el.focus();
            // 기존 내용 전체 선택
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            // 1순위: paste 이벤트 (에디터가 자체 핸들러로 처리 → 내부 모델까지 갱신됨)
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            const pasteEvt = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
            });
            const notHandled = el.dispatchEvent(pasteEvt);

            // 2순위: execCommand (에디터가 paste를 무시한 경우)
            if (notHandled) {
                document.execCommand('insertText', false, text);
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        } catch {
            return false;
        }
    }

    /** 여러 문단을 본문에 순차 입력 (문단 사이 개행 유지) */
    function insertBody(el, body) {
        // 스마트에디터는 \n을 문단 분리로 처리한다. paste 경로가 이를 알아서 나눠준다.
        return insertText(el, body);
    }

    // ── 이미지 첨부 ─────────────────────────────────────────────

    /**
     * 이미지 자동 첨부.
     * 숨겨진 file input에 File 객체를 주입하는 방식을 시도하고,
     * 실패하면 사용자에게 수동 첨부를 안내한다(다운로드 링크 제공).
     *
     * ⚠️ 스마트에디터 ONE에서 이 방식이 실제로 통하는지는 로그인된 실제 에디터에서
     *    검증이 필요하다. 실패해도 원고(제목/본문)는 이미 들어간 상태이므로 안전하다.
     */
    async function attachImages(images) {
        if (!Array.isArray(images) || images.length === 0) return { attached: 0, failed: 0 };

        const fileInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
        if (!fileInput) return { attached: 0, failed: images.length, reason: 'no-input' };

        let attached = 0;
        const dt = new DataTransfer();

        for (const img of images) {
            try {
                let dataUrl = img.dataUrl || img.data;
                if (!dataUrl && img.url) {
                    const res = await sendBg('api.fetchImage', { url: img.url });
                    if (!res.ok) continue;
                    dataUrl = res.data.dataUrl;
                }
                if (!dataUrl) continue;

                const blob = await (await fetch(dataUrl)).blob();
                const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
                dt.items.add(new File([blob], `redple-${attached + 1}.${ext}`, { type: blob.type }));
                attached++;
            } catch { /* 개별 이미지 실패는 건너뜀 */ }
        }

        if (attached === 0) return { attached: 0, failed: images.length, reason: 'convert-failed' };

        try {
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            return { attached, failed: images.length - attached };
        } catch {
            return { attached: 0, failed: images.length, reason: 'assign-failed' };
        }
    }

    // ── 클립보드에서 레드랭크 원고 읽기 ─────────────────────────

    async function readDraftFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text || !text.includes(DRAFT_MAGIC)) return null;
            const payload = JSON.parse(text);
            if (!payload || !payload[DRAFT_MAGIC]) return null;
            return payload;
        } catch {
            return null; // 권한 거부 등
        }
    }

    /** 원고 객체(이미 파싱됨)를 실제 에디터에 채운다. 사이드패널 직접전송/클립보드 양쪽에서 공용으로 쓴다. */
    async function applyDraftObject(draft) {
        const titleEl = getTitleEl();
        const bodyEl = getBodyEl();

        let done = [];
        if (draft.title && titleEl && insertText(titleEl, draft.title)) done.push('제목');
        if (draft.body && bodyEl && insertBody(bodyEl, draft.body)) done.push('본문');

        // 이미지
        let imgMsg = '';
        if (Array.isArray(draft.images) && draft.images.length) {
            const r = await attachImages(draft.images);
            if (r.attached > 0) {
                done.push(`이미지 ${r.attached}장`);
            } else {
                imgMsg = ' (이미지는 자동 첨부에 실패해 직접 올려주셔야 합니다)';
            }
        }

        // 태그는 별도 입력창이라 안내만
        if (Array.isArray(draft.tags) && draft.tags.length) {
            state.pendingTags = draft.tags;
        }

        if (done.length === 0) {
            toast('자동 입력에 실패했습니다. 본문을 클립보드에 복사했으니 직접 붙여넣어 주세요.', 'error');
            try { await navigator.clipboard.writeText(draft.body || ''); } catch { /* noop */ }
        } else {
            toast(`${done.join(' · ')} 입력 완료${imgMsg}`, 'ok');
        }
        refreshStats();
        renderTagHint();
        return { applied: done, imageResult: imgMsg };
    }

    /** 패널의 "레드랭크 원고 불러오기" 버튼 — 클립보드에서 읽어서 적용 */
    async function applyDraft() {
        const draft = await readDraftFromClipboard();
        if (!draft) {
            toast('클립보드에 레드랭크 원고가 없습니다. 레드랭크에서 "네이버 확장으로 보내기"를 먼저 눌러주세요.', 'warn');
            return;
        }
        await applyDraftObject(draft);
    }

    // ── 통계/검사 ───────────────────────────────────────────────

    /** 금지어·과장광고 표현 사전 (네이버 블로그 + 표시광고법 기준) */
    const BANNED_PATTERNS = [
        { re: /최고(의|를|입니다)?/g, type: '최상급', hint: '"최고" 등 최상급 표현은 객관적 근거 없이 쓰면 과장광고' },
        { re: /100%\s*(보장|효과|성공)/g, type: '절대보장', hint: '100% 보장 표현은 표시광고법 위반 소지' },
        { re: /완치|즉시\s*효과|부작용\s*없/g, type: '의료과장', hint: '치료 효과 단정은 의료법 위반 소지' },
        { re: /No\.?\s*1|넘버원|1위(?!\s*블로그)/gi, type: '순위주장', hint: '1위 주장은 객관적 출처 명시 필요' },
        { re: /무조건|절대\s*(안전|확실)/g, type: '단정표현', hint: '단정적 표현은 과장광고 소지' },
        { re: /특허\s*받은|정부\s*인증|공식\s*인증/g, type: '인증주장', hint: '인증·특허 주장은 실제 번호/근거 필요' },
        { re: /최저가|국내\s*유일|업계\s*최초/g, type: '배타주장', hint: '배타적 주장은 입증 자료 필요' },
        { re: /돈\s*버는|수익\s*보장|원금\s*보장/g, type: '금융과장', hint: '수익·원금 보장은 금융광고 규제 대상' },
    ];

    function getText(el) {
        return el ? (el.innerText || el.textContent || '') : '';
    }

    function collectBodyText() {
        // 본문 문단이 여러 개 컴포넌트로 나뉘므로 전부 수집
        const paras = document.querySelectorAll('.se-component.se-text .se-text-paragraph, .se-main-container .se-text-paragraph');
        if (paras.length) return Array.from(paras).map(getText).join('\n');
        return getText(getBodyEl());
    }

    function countMedia() {
        const imgs = document.querySelectorAll('.se-component.se-image, .se-image-resource, .se-module-image').length;
        const vids = document.querySelectorAll('.se-component.se-video, .se-video-resource, .se-component.se-oglink video').length;
        return { imgs, vids };
    }

    const state = { text: '', banned: [], pendingTags: null };

    function refreshStats() {
        const text = collectBodyText();
        state.text = text;

        const withSpace = text.length;
        const noSpace = text.replace(/\s/g, '').length;
        const { imgs, vids } = countMedia();

        // 금지어 검출
        const found = [];
        for (const p of BANNED_PATTERNS) {
            p.re.lastIndex = 0;
            const matches = text.match(p.re);
            if (matches && matches.length) {
                found.push({ type: p.type, hint: p.hint, words: [...new Set(matches)].slice(0, 4), count: matches.length });
            }
        }
        state.banned = found;

        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        panel.querySelector('#redple-c-nospace').textContent = noSpace.toLocaleString('ko-KR');
        panel.querySelector('#redple-c-space').textContent = withSpace.toLocaleString('ko-KR');
        panel.querySelector('#redple-c-img').textContent = imgs;
        panel.querySelector('#redple-c-vid').textContent = vids;

        // 글자수 가이드 (SEO 권장 1500자 이상)
        const guide = panel.querySelector('#redple-guide');
        if (noSpace >= 1500) {
            guide.className = 'redple-guide redple-guide-ok';
            guide.textContent = '권장 분량 충족 (1,500자+)';
        } else if (noSpace >= 700) {
            guide.className = 'redple-guide redple-guide-warn';
            guide.textContent = `1,500자까지 ${(1500 - noSpace).toLocaleString('ko-KR')}자 남음`;
        } else {
            guide.className = 'redple-guide redple-guide-low';
            guide.textContent = `분량 부족 — 1,500자까지 ${(1500 - noSpace).toLocaleString('ko-KR')}자`;
        }

        renderBanned();
    }

    function renderBanned() {
        const box = document.querySelector('#redple-banned');
        if (!box) return;
        if (!state.banned.length) {
            box.innerHTML = '<p class="redple-empty">검출된 금지어·과장 표현이 없습니다</p>';
            return;
        }
        box.innerHTML = state.banned.map((b) => `
          <div class="redple-banned-item">
            <div class="redple-banned-head">
              <span class="redple-banned-type">${esc(b.type)}</span>
              <span class="redple-banned-count">${b.count}건</span>
            </div>
            <div class="redple-banned-words">${b.words.map((w) => `<code>${esc(w)}</code>`).join(' ')}</div>
            <p class="redple-banned-hint">${esc(b.hint)}</p>
          </div>`).join('');
    }

    function renderTagHint() {
        const box = document.querySelector('#redple-tags');
        if (!box) return;
        if (!state.pendingTags?.length) { box.innerHTML = ''; return; }
        box.innerHTML = `
          <div class="redple-tag-hint">
            <p>태그는 에디터 하단 태그창에 직접 입력해주세요.</p>
            <div class="redple-tag-list">${state.pendingTags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>
            <button id="redple-copy-tags" class="redple-btn redple-btn-sm">태그 복사</button>
          </div>`;
        box.querySelector('#redple-copy-tags').addEventListener('click', async () => {
            await navigator.clipboard.writeText(state.pendingTags.map((t) => `#${t}`).join(' '));
            toast('태그를 복사했습니다', 'ok');
        });
    }

    // ── 법적 검사 / 형태소 ──────────────────────────────────────

    async function runLegalCheck(category) {
        const text = state.text.trim();
        if (text.length < 10) { toast('본문을 10자 이상 작성한 뒤 검사해주세요', 'warn'); return; }

        const box = document.querySelector('#redple-legal-result');
        box.innerHTML = '<p class="redple-loading">검사 중…</p>';

        const res = await sendBg('api.legalCheck', { text: text.slice(0, 10000), category });
        if (!res.ok) {
            box.innerHTML = `<p class="redple-error-inline">${esc(res.error || '검사 실패')}${res.needLogin ? ' — 레드랭크에 로그인해주세요' : ''}</p>`;
            return;
        }

        const r = res.data || {};
        const issues = Array.isArray(r.issues) ? r.issues : [];
        const scoreColor = r.safetyScore >= 80 ? '#1a8046' : r.safetyScore >= 50 ? '#a86a00' : '#c22';

        box.innerHTML = `
          <div class="redple-legal-score" style="color:${scoreColor}">
            안전도 ${r.safetyScore ?? '-'}점 <span class="redple-legal-risk">${esc(r.riskLevel || '')}</span>
          </div>
          <p class="redple-legal-summary">${esc(r.summary || '')}</p>
          ${issues.length ? issues.map((i) => `
            <div class="redple-legal-issue redple-sev-${esc(i.severity || 'low')}">
              <div class="redple-legal-text">"${esc(i.text || '')}"</div>
              <div class="redple-legal-law">${esc(i.law || '')}</div>
              <p class="redple-legal-reason">${esc(i.reason || '')}</p>
              <p class="redple-legal-fix">→ ${esc(i.suggestion || '')}</p>
            </div>`).join('') : '<p class="redple-empty">지적된 위험 문구가 없습니다</p>'}`;
    }

    async function runMorpheme() {
        const text = state.text.trim();
        if (text.length < 10) { toast('본문을 10자 이상 작성한 뒤 분석해주세요', 'warn'); return; }

        const box = document.querySelector('#redple-morph-result');
        box.innerHTML = '<p class="redple-loading">분석 중…</p>';

        const res = await sendBg('api.nlp', { text: text.slice(0, 50000), mode: 'morpheme' });
        if (!res.ok) {
            box.innerHTML = `<p class="redple-error-inline">${esc(res.error || '분석 실패')}${res.needLogin ? ' — 레드랭크에 로그인해주세요' : ''}</p>`;
            return;
        }

        // NLP 서버 응답 형태가 버전에 따라 다를 수 있어 방어적으로 파싱
        const d = res.data || {};
        const list = d.nouns || d.keywords || d.morphemes || d.result || [];
        const rows = (Array.isArray(list) ? list : []).slice(0, 20).map((it) => {
            if (typeof it === 'string') return { word: it, count: null };
            return { word: it.word || it.text || it.noun || it[0], count: it.count ?? it.freq ?? it[1] ?? null };
        }).filter((r) => r.word);

        if (!rows.length) {
            box.innerHTML = '<p class="redple-empty">추출된 키워드가 없습니다</p>';
            return;
        }
        const max = Math.max(...rows.map((r) => r.count || 1));
        box.innerHTML = `<div class="redple-morph-list">${rows.map((r) => `
            <div class="redple-morph-row">
              <span class="redple-morph-word">${esc(r.word)}</span>
              <span class="redple-morph-bar"><i style="width:${Math.round(((r.count || 1) / max) * 100)}%"></i></span>
              <span class="redple-morph-count">${r.count ?? ''}</span>
            </div>`).join('')}</div>`;
    }

    // ── 방해 팝업 자동 닫기 ─────────────────────────────────────

    function autoCloseDraftPopup() {
        // "작성 중인 글이 있습니다" 이어쓰기 팝업 → 취소(새로 작성)
        const cancelBtns = document.querySelectorAll('.se-popup-button-cancel, .btn_cancel, button.se-popup-button');
        for (const btn of cancelBtns) {
            const t = (btn.textContent || '').trim();
            if (t === '취소' || t === '아니오' || t.includes('새로')) {
                btn.click();
                return true;
            }
        }
        // 도움말 레이어
        document.querySelector('.se-help-panel-close-button, .se-guide-close')?.click();
        return false;
    }

    // ── UI ──────────────────────────────────────────────────────

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function toast(msg, kind = 'ok') {
        document.querySelector('.redple-toast')?.remove();
        const t = document.createElement('div');
        t.className = `redple-toast redple-toast-${kind}`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('redple-toast-out'), 3200);
        setTimeout(() => t.remove(), 3600);
    }

    function sendBg(cmd, payload = {}) {
        return new Promise((resolve) => {
            try {
                chromeApi.runtime.sendMessage({ cmd, ...payload }, (res) => {
                    if (chromeApi.runtime.lastError) {
                        resolve({ ok: false, error: chromeApi.runtime.lastError.message });
                        return;
                    }
                    resolve(res || { ok: false, error: '응답 없음' });
                });
            } catch (e) {
                resolve({ ok: false, error: String(e) });
            }
        });
    }

    function buildPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        const collapsed = localStorage.getItem('redple-panel-collapsed') === '1';
        if (collapsed) panel.classList.add('redple-collapsed');

        panel.innerHTML = `
          <div class="redple-head">
            <span class="redple-logo">R</span>
            <span class="redple-title">레드플</span>
            <button class="redple-toggle" title="접기/펼치기">${collapsed ? '+' : '−'}</button>
          </div>

          <div class="redple-body">
            <button id="redple-open-panel" class="redple-btn redple-btn-primary">
              AI 원고 생성 열기
            </button>
            <button id="redple-apply" class="redple-btn redple-btn-sm redple-btn-apply">
              레드랭크 원고 다시 불러오기
            </button>
            <p class="redple-hint">AI 원고 생성에서 만든 원고는 자동으로 채워집니다. 안 채워졌다면 이 버튼으로 다시 시도하세요.</p>

            <div class="redple-counters">
              <div class="redple-counter">
                <b id="redple-c-nospace">0</b><span>공백제외</span>
              </div>
              <div class="redple-counter">
                <b id="redple-c-space">0</b><span>공백포함</span>
              </div>
              <div class="redple-counter">
                <b id="redple-c-img">0</b><span>이미지</span>
              </div>
              <div class="redple-counter">
                <b id="redple-c-vid">0</b><span>동영상</span>
              </div>
            </div>
            <div id="redple-guide" class="redple-guide redple-guide-low">분량 부족</div>

            <div id="redple-tags"></div>

            <div class="redple-tabs">
              <button class="redple-tab redple-tab-on" data-tab="banned">금지어</button>
              <button class="redple-tab" data-tab="legal">법적검사</button>
              <button class="redple-tab" data-tab="morph">형태소</button>
            </div>

            <div class="redple-tabpanes">
              <div class="redple-pane redple-pane-on" data-pane="banned">
                <div id="redple-banned"><p class="redple-empty">본문을 작성하면 자동으로 검사합니다</p></div>
              </div>

              <div class="redple-pane" data-pane="legal">
                <div class="redple-legal-cats">
                  <button class="redple-cat" data-cat="medical">의료</button>
                  <button class="redple-cat" data-cat="legal">법률</button>
                  <button class="redple-cat" data-cat="food">식품</button>
                  <button class="redple-cat" data-cat="finance">금융</button>
                </div>
                <div id="redple-legal-result"><p class="redple-empty">분야를 선택하면 검사합니다</p></div>
              </div>

              <div class="redple-pane" data-pane="morph">
                <button id="redple-morph-run" class="redple-btn redple-btn-sm">형태소 분석 실행</button>
                <div id="redple-morph-result"><p class="redple-empty">본문의 키워드 빈도를 확인합니다</p></div>
              </div>
            </div>
          </div>`;

        document.body.appendChild(panel);

        // 이벤트 바인딩
        panel.querySelector('.redple-toggle').addEventListener('click', () => {
            const now = panel.classList.toggle('redple-collapsed');
            localStorage.setItem('redple-panel-collapsed', now ? '1' : '0');
            panel.querySelector('.redple-toggle').textContent = now ? '+' : '−';
        });

        panel.querySelector('#redple-apply').addEventListener('click', applyDraft);
        panel.querySelector('#redple-open-panel').addEventListener('click', () => sendBg('panel.open'));
        panel.querySelector('#redple-morph-run').addEventListener('click', runMorpheme);

        panel.querySelectorAll('.redple-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.redple-tab').forEach((t) => t.classList.remove('redple-tab-on'));
                panel.querySelectorAll('.redple-pane').forEach((p) => p.classList.remove('redple-pane-on'));
                tab.classList.add('redple-tab-on');
                panel.querySelector(`.redple-pane[data-pane="${tab.dataset.tab}"]`)?.classList.add('redple-pane-on');
            });
        });

        panel.querySelectorAll('.redple-cat').forEach((btn) => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.redple-cat').forEach((b) => b.classList.remove('redple-cat-on'));
                btn.classList.add('redple-cat-on');
                runLegalCheck(btn.dataset.cat);
            });
        });
    }

    // ── 부트 ────────────────────────────────────────────────────

    async function boot() {
        const { settings } = await chromeApi.storage.local.get('settings');
        const s = { editorTools: true, autoCloseDraftPopup: true, ...(settings || {}) };
        if (!s.editorTools) return;

        // 에디터가 이 프레임에 나타날 때까지 대기 (스마트에디터는 지연 로딩)
        let tries = 0;
        const wait = setInterval(() => {
            tries++;
            if (s.autoCloseDraftPopup) autoCloseDraftPopup();

            if (hasEditor()) {
                clearInterval(wait);
                buildPanel();
                refreshStats();

                // 본문 변경 감지 (입력마다 재계산하면 무거우므로 디바운스)
                let timer = null;
                const mo = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(refreshStats, 400);
                });
                const target = document.querySelector('.se-main-container, #editorContainer') || document.body;
                mo.observe(target, { childList: true, subtree: true, characterData: true });
            }
            if (tries > 40) clearInterval(wait); // 20초 후 포기
        }, 500);
    }

    // 사이드패널(AI 원고 생성)이 클립보드를 거치지 않고 이 탭에 바로 원고를 보낼 때 받는 창구.
    // hasEditor()가 true인 프레임(보통 mainFrame iframe)만 실제로 적용한다.
    chromeApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.cmd !== 'redple.applyDraft') return false;
        if (!hasEditor()) {
            sendResponse({ ok: false, error: 'no-editor-in-frame' });
            return false;
        }
        applyDraftObject(msg.draft)
            .then((r) => sendResponse({ ok: true, ...r }))
            .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
        return true; // 비동기 응답
    });

    boot();
})();
