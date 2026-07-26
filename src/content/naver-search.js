/**
 * 레드플 — 네이버 검색결과 오버레이 (search.naver.com)
 *
 * 검색 키워드의 월간 검색량(PC/모바일)·블로그 문서수·경쟁률·포화도·황금키워드 여부와
 * 12개월 검색 트렌드 스파크라인, 검색결과(SERP) 섹션 구성 순서를 우측 상단 카드로 표시한다.
 *
 * 콘텐트 스크립트는 ES 모듈 불가 → IIFE 단일 파일. 네트워크는 전부 background 경유.
 */
(() => {
    'use strict';

    const chromeApi = /** @type {any} */ (globalThis.chrome);
    const CARD_ID = 'redple-search-card';
    let lastQuery = null;

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

    async function getSettings() {
        const { settings } = await chromeApi.storage.local.get('settings');
        return {
            searchOverlay: true,
            ...(settings || {}),
        };
    }

    function getQuery() {
        const params = new URLSearchParams(location.search);
        return (params.get('query') || '').trim();
    }

    function fmt(n) {
        if (n == null || isNaN(n)) return '-';
        return Number(n).toLocaleString('ko-KR');
    }

    /** SERP 섹션 구성 분석 — 페이지의 주요 콘텐츠 블록 헤더를 순서대로 수집 */
    function analyzeSerpSections() {
        const KNOWN = [
            '파워링크', '인기글', '블로그', '카페', '인플루언서', '지식iN', '지식인',
            '뉴스', '동영상', '이미지', '쇼핑', '웹사이트', '어학사전', '지도', '플레이스',
            'VIEW', '스마트블록', '함께 보는 콘텐츠', '브랜드 콘텐츠',
        ];
        const found = [];
        const headers = document.querySelectorAll('h2, .api_title, .fds-comps-header-headline, strong.title');
        headers.forEach((h) => {
            const t = (h.textContent || '').trim();
            if (!t || t.length > 20) return;
            const match = KNOWN.find((k) => t === k || t.startsWith(k));
            if (match && !found.includes(match)) found.push(match);
        });
        return found.slice(0, 8);
    }

    /** 인라인 SVG 스파크라인 (12개월 트렌드) */
    function sparkline(trend) {
        if (!Array.isArray(trend) || trend.length < 2) return '';
        const W = 220, H = 44, PAD = 3;
        const ratios = trend.map((t) => Number(t.ratio) || 0);
        const max = Math.max(...ratios, 1);
        const pts = ratios.map((r, i) => {
            const x = PAD + (i / (ratios.length - 1)) * (W - PAD * 2);
            const y = H - PAD - (r / max) * (H - PAD * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const areaPts = `${PAD},${H - PAD} ${pts.join(' ')} ${W - PAD},${H - PAD}`;
        return `
          <svg viewBox="0 0 ${W} ${H}" class="redple-spark" aria-label="12개월 검색 트렌드">
            <polygon points="${areaPts}" fill="rgba(255,59,59,0.12)"/>
            <polyline points="${pts.join(' ')}" fill="none" stroke="#ff3b3b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          </svg>`;
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function competitionBadge(data) {
        if (data.isGolden) return '<span class="redple-badge redple-badge-gold">황금 키워드</span>';
        const r = Number(data.competitionRatio);
        if (isNaN(r)) return '';
        if (r < 5) return '<span class="redple-badge redple-badge-green">경쟁 낮음</span>';
        if (r < 20) return '<span class="redple-badge redple-badge-yellow">경쟁 보통</span>';
        return '<span class="redple-badge redple-badge-red">경쟁 높음</span>';
    }

    function render(query, data, sections) {
        removeCard();
        const card = document.createElement('div');
        card.id = CARD_ID;

        const collapsed = sessionStorage.getItem('redple-collapsed') === '1';
        if (collapsed) card.classList.add('redple-collapsed');

        const sectionsHtml = sections.length
            ? `<div class="redple-row redple-sections">
                 <span class="redple-label">노출 순서</span>
                 <span class="redple-section-list">${sections.map((s, i) =>
                    `<span class="redple-section-chip${s === '블로그' || s === '인플루언서' ? ' redple-chip-hot' : ''}">${i + 1}. ${esc(s)}</span>`).join('')}
                 </span>
               </div>`
            : '';

        card.innerHTML = `
          <div class="redple-head">
            <span class="redple-logo">R</span>
            <span class="redple-title">레드플 키워드 분석</span>
            <button class="redple-toggle" title="접기/펼치기">${collapsed ? '+' : '−'}</button>
          </div>
          <div class="redple-body">
            <div class="redple-keyword">
              <b>${esc(query)}</b>
              ${competitionBadge(data)}
            </div>
            <div class="redple-stats">
              <div class="redple-stat">
                <span class="redple-stat-num">${fmt(data.monthlySearch)}</span>
                <span class="redple-stat-label">월간 검색량</span>
              </div>
              <div class="redple-stat">
                <span class="redple-stat-num">${fmt(data.pcSearch)}</span>
                <span class="redple-stat-label">PC</span>
              </div>
              <div class="redple-stat">
                <span class="redple-stat-num">${fmt(data.mobileSearch)}</span>
                <span class="redple-stat-label">모바일</span>
              </div>
              <div class="redple-stat">
                <span class="redple-stat-num">${fmt(data.docCount)}</span>
                <span class="redple-stat-label">블로그 문서수</span>
              </div>
              <div class="redple-stat">
                <span class="redple-stat-num">${data.competitionRatio ?? '-'}</span>
                <span class="redple-stat-label">경쟁률</span>
              </div>
              <div class="redple-stat">
                <span class="redple-stat-num">${data.saturation ?? '-'}%</span>
                <span class="redple-stat-label">포화도</span>
              </div>
            </div>
            ${sparkline(data.trendData)}
            ${sectionsHtml}
            <a class="redple-more" href="https://www.redrank.kr/keyword/analyze?keyword=${encodeURIComponent(query)}" target="_blank" rel="noopener">레드랭크에서 상세 분석 →</a>
          </div>`;

        card.querySelector('.redple-toggle').addEventListener('click', () => {
            const isNow = card.classList.toggle('redple-collapsed');
            sessionStorage.setItem('redple-collapsed', isNow ? '1' : '0');
            card.querySelector('.redple-toggle').textContent = isNow ? '+' : '−';
        });

        document.body.appendChild(card);
    }

    function renderError(query, message) {
        removeCard();
        const card = document.createElement('div');
        card.id = CARD_ID;
        card.innerHTML = `
          <div class="redple-head">
            <span class="redple-logo">R</span>
            <span class="redple-title">레드플</span>
            <button class="redple-toggle" title="닫기">×</button>
          </div>
          <div class="redple-body">
            <div class="redple-keyword"><b>${esc(query)}</b></div>
            <p class="redple-error">${esc(message)}</p>
          </div>`;
        card.querySelector('.redple-toggle').addEventListener('click', removeCard);
        document.body.appendChild(card);
    }

    function removeCard() {
        document.getElementById(CARD_ID)?.remove();
    }

    async function run() {
        const settings = await getSettings();
        if (!settings.searchOverlay) { removeCard(); return; }

        const query = getQuery();
        if (!query || query === lastQuery) return;
        lastQuery = query;

        const res = await sendBg('api.keyword', { keyword: query });
        // 탭 URL이 그 사이 바뀌었으면 무시
        if (getQuery() !== query) return;

        if (!res.ok) {
            renderError(query, res.error || '검색량 조회에 실패했습니다');
            return;
        }
        render(query, res.data || {}, analyzeSerpSections());
    }

    // 네이버 검색은 SPA처럼 pushState로 쿼리가 바뀌는 경우가 있어 주기적으로 감지
    run();
    let urlWas = location.href;
    setInterval(() => {
        if (location.href !== urlWas) {
            urlWas = location.href;
            lastQuery = null;
            run();
        }
    }, 800);

    // 설정 토글 실시간 반영
    chromeApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) {
            lastQuery = null;
            run();
        }
    });
})();
