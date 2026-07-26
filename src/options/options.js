import { api } from '../common/api.js';
import { DEFAULT_SETTINGS, getSettings, setSettings, getApiKey, setApiKey, setCachedUser } from '../common/storage.js';

const chromeApi = /** @type {any} */ (globalThis.chrome);
const $ = (id) => document.getElementById(id);

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2500);
}

// ── 로드 ────────────────────────────────────────────────────

async function load() {
    const s = await getSettings();
    $('opt-search').checked = s.searchOverlay;
    $('opt-editor').checked = s.editorTools;
    $('opt-popup').checked = s.autoCloseDraftPopup;
    $('api-base').value = s.apiBase || DEFAULT_SETTINGS.apiBase;

    const key = await getApiKey();
    if (key) $('api-key').value = key;

    $('ver').textContent = '레드플 v' + chromeApi.runtime.getManifest().version;
}

// ── API 키 ──────────────────────────────────────────────────

$('toggle-key').addEventListener('click', () => {
    const input = $('api-key');
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    $('toggle-key').textContent = isPw ? '숨기기' : '보기';
});

$('save-key').addEventListener('click', async () => {
    const key = $('api-key').value.trim();
    const status = $('key-status');

    if (!key) {
        await setApiKey('');
        await setCachedUser(null);
        status.className = 'status status-err';
        status.textContent = '연결이 해제되었습니다.';
        return;
    }

    status.className = 'status';
    status.textContent = '확인 중…';

    const res = await api.verify(key);
    if (res.ok && res.data?.user) {
        await setApiKey(key);
        await setCachedUser(res.data.user);
        const u = res.data.user;
        status.className = 'status status-ok';
        status.textContent = `연결됨 — ${u.displayName || '사용자'} (${(u.plan || 'free').toUpperCase()} 플랜, ${(u.coins?.total ?? 0).toLocaleString('ko-KR')}코인)`;
    } else {
        status.className = 'status status-err';
        status.textContent = res.error || '키 확인에 실패했습니다. 레드랭크에서 다시 발급받아 주세요.';
    }
});

// ── 기능 토글 ───────────────────────────────────────────────

for (const [id, field] of [
    ['opt-search', 'searchOverlay'],
    ['opt-editor', 'editorTools'],
    ['opt-popup', 'autoCloseDraftPopup'],
]) {
    $(id).addEventListener('change', async (e) => {
        await setSettings({ [field]: e.target.checked });
        toast('저장되었습니다');
    });
}

// ── API 주소 ────────────────────────────────────────────────

$('save-base').addEventListener('click', async () => {
    const base = $('api-base').value.trim() || DEFAULT_SETTINGS.apiBase;
    await setSettings({ apiBase: base.replace(/\/$/, '') });
    toast('저장되었습니다');
});

load();
