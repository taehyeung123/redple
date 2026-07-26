/**
 * 확장 페이지(팝업/옵션/사이드패널) → 백그라운드 메시지 브릿지.
 * 네트워크 호출은 전부 background.js가 수행한다.
 */

const chromeApi = /** @type {any} */ (globalThis.chrome);

export function send(cmd, payload = {}) {
    return new Promise((resolve) => {
        chromeApi.runtime.sendMessage({ cmd, ...payload }, (res) => {
            if (chromeApi.runtime.lastError) {
                resolve({ ok: false, error: chromeApi.runtime.lastError.message });
                return;
            }
            resolve(res || { ok: false, error: '응답 없음' });
        });
    });
}

export const api = {
    verify: (apiKey) => send('api.verify', { apiKey }),
    keyword: (keyword) => send('api.keyword', { keyword }),
    generate: (body) => send('api.generate', { body }),
    legalCheck: (text, category) => send('api.legalCheck', { text, category }),
    nlp: (text, mode) => send('api.nlp', { text, mode }),
};

/** 플랜 라벨/색상 */
export const PLAN_META = {
    free: { label: 'Free', color: '#8a8a8a' },
    basic: { label: 'Basic', color: '#4a9eff' },
    pro: { label: 'Pro', color: '#ff3b3b' },
    premium: { label: 'Premium', color: '#ffd700' },
};

export function fmtNum(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('ko-KR');
}
