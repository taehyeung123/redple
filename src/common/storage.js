/**
 * chrome.storage 접근 헬퍼 — 확장 페이지(팝업/옵션/사이드패널)와 백그라운드 공용.
 * (콘텐트 스크립트는 ES 모듈을 못 쓰므로 chrome.storage를 직접 읽는다 — 키 이름을 여기와 맞출 것)
 */

const chromeApi = /** @type {any} */ (globalThis.chrome);

export const DEFAULT_SETTINGS = {
    apiBase: 'https://www.redrank.kr',
    searchOverlay: true,       // 네이버 검색 결과 검색량 오버레이
    editorTools: true,         // 블로그 에디터 도구 패널
    autoCloseDraftPopup: true, // "작성 중인 글" 팝업 자동 닫기
};

export async function getSettings() {
    const { settings } = await chromeApi.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
    const cur = await getSettings();
    const next = { ...cur, ...patch };
    await chromeApi.storage.local.set({ settings: next });
    return next;
}

export async function getApiKey() {
    const { apiKey } = await chromeApi.storage.local.get('apiKey');
    return apiKey || '';
}

export async function setApiKey(key) {
    await chromeApi.storage.local.set({ apiKey: key || '' });
}

export async function getCachedUser() {
    const { user } = await chromeApi.storage.local.get('user');
    return user || null;
}

export async function setCachedUser(user) {
    await chromeApi.storage.local.set({ user: user || null });
}
