/**
 * 레드플 백그라운드 서비스 워커 (MV3)
 *
 * 모든 네트워크 호출은 여기서만 한다.
 *  - host_permissions에 redrank.kr이 있으므로 CORS 제약 없이 호출 가능
 *  - credentials:'include'로 레드랭크 로그인 쿠키가 함께 전송됨
 *    → 로그인/코인이 필요한 API(원고 생성·법적 검사·형태소)는 사용자가
 *      www.redrank.kr에 로그인돼 있으면 그대로 동작한다.
 *  - API 키(X-RR-API-Key)는 플랜/코인 표시용(/api/extension/verify)에 사용.
 */

import { DEFAULT_SETTINGS, getSettings, getApiKey } from './common/storage.js';

const chromeApi = /** @type {any} */ (globalThis.chrome);

async function apiBase() {
    const s = await getSettings();
    return (s.apiBase || DEFAULT_SETTINGS.apiBase).replace(/\/$/, '');
}

/** 공통 fetch 래퍼 — { ok, status, data | error } 형태로 통일 */
async function callRedrank(path, { method = 'GET', body, headers = {} } = {}) {
    const base = await apiBase();
    try {
        const res = await fetch(base + path, {
            method,
            credentials: 'include',
            headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch { /* 비JSON 응답 */ }
        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                error: (data && data.error) || `요청 실패 (HTTP ${res.status})`,
                needLogin: res.status === 401,
            };
        }
        return { ok: true, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, error: '네트워크 오류 — 인터넷 연결을 확인해주세요' };
    }
}

// ── 명령 핸들러 ──────────────────────────────────────────────

const handlers = {
    /** API 키로 플랜/코인 조회 */
    async 'api.verify'({ apiKey }) {
        const key = apiKey || (await getApiKey());
        if (!key) return { ok: false, status: 401, error: 'API 키가 없습니다', needKey: true };
        return callRedrank('/api/extension/verify', {
            method: 'POST',
            headers: { 'X-RR-API-Key': key },
            body: {},
        });
    },

    /** 키워드 검색량/경쟁도 (로그인 불필요, IP 레이트리밋만) */
    async 'api.keyword'({ keyword }) {
        if (!keyword) return { ok: false, error: '키워드가 없습니다' };
        return callRedrank(`/api/keyword/analyze?keyword=${encodeURIComponent(keyword)}`);
    },

    /** AI 원고 생성 (레드랭크 로그인 + 코인 필요) */
    async 'api.generate'(payload) {
        return callRedrank('/api/ai/generate', { method: 'POST', body: payload.body });
    },

    /** 법적 위험 검사 (레드랭크 로그인 + 코인 필요) */
    async 'api.legalCheck'({ text, category }) {
        return callRedrank('/api/ai/legal-check', { method: 'POST', body: { text, category } });
    },

    /** 형태소/맞춤법 (레드랭크 로그인 필요) */
    async 'api.nlp'({ text, mode }) {
        return callRedrank('/api/nlp/analyze', { method: 'POST', body: { text, mode } });
    },

    /** 이미지 URL → dataURL (에디터 첨부용; 콘텐트 스크립트의 CORS 우회) */
    async 'api.fetchImage'({ url }) {
        try {
            const res = await fetch(url, { credentials: 'omit' });
            if (!res.ok) return { ok: false, error: `이미지 로드 실패 (HTTP ${res.status})` };
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(blob);
            });
            return { ok: true, data: { dataUrl, type: blob.type } };
        } catch {
            return { ok: false, error: '이미지 로드 중 오류' };
        }
    },

    /** 사이드패널 열기 (사용자 제스처 컨텍스트에서 호출됨) */
    async 'panel.open'(_payload, sender) {
        if (sender?.tab?.id != null) {
            await chromeApi.sidePanel.open({ tabId: sender.tab.id });
            return { ok: true };
        }
        return { ok: false, error: '탭 정보를 찾을 수 없습니다' };
    },
};

chromeApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = handlers[msg?.cmd];
    if (!handler) {
        sendResponse({ ok: false, error: `알 수 없는 명령: ${msg?.cmd}` });
        return false;
    }
    handler(msg, sender)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // async 응답
});

// ── 컨텍스트 메뉴: 선택 텍스트 검색량 조회 ───────────────────

chromeApi.runtime.onInstalled.addListener(() => {
    chromeApi.contextMenus.create({
        id: 'redple-keyword-lookup',
        title: '레드플: "%s" 검색량 조회',
        contexts: ['selection'],
    });
});

chromeApi.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'redple-keyword-lookup' || !info.selectionText) return;
    const keyword = info.selectionText.trim().slice(0, 100);
    await chromeApi.storage.local.set({ pendingKeyword: keyword, pendingKeywordTs: Date.now() });
    if (tab?.id != null) await chromeApi.sidePanel.open({ tabId: tab.id });
});
