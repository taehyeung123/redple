/**
 * 블로그 글 유형 — 레드랭크 `src/lib/blogCategories.ts`와 동일한 id/그룹 체계.
 * ⚠️ 레드랭크에서 카테고리를 추가/변경하면 이 파일도 함께 갱신해야 한다
 *    (id가 API로 그대로 전달되므로 불일치 시 400 에러).
 */

export const CATEGORY_GROUPS = [
    { group: '후기형', hint: '직접 경험을 바탕으로 쓰는 진짜 후기' },
    { group: '정보형', hint: '노하우와 정보를 체계적으로 정리' },
    { group: '재구성형', hint: '원본 자료를 나만의 새 글로 재작성' },
    { group: '홍보형', hint: '상품·서비스를 자연스럽게 홍보' },
];

export const CATEGORIES = [
    {
        id: 'product_review', label: '제품후기', group: '후기형',
        description: '직접 사용한 제품의 내돈내산 실사용 후기',
        requiresSource: false, experienceRequired: true,
    },
    {
        id: 'visit_review', label: '방문후기', group: '후기형',
        description: '식당·카페·매장 등 직접 방문한 곳의 후기',
        requiresSource: false, experienceRequired: true,
    },
    {
        id: 'business_review', label: '업체후기', group: '후기형',
        description: '시공·수리·서비스 업체 이용 경험 후기',
        requiresSource: false, experienceRequired: true,
    },
    {
        id: 'travel_review', label: '여행후기', group: '후기형',
        description: '여행지·숙소·코스를 담은 여행 기록',
        requiresSource: false, experienceRequired: true,
    },
    {
        id: 'info_post', label: '정보성글', group: '정보형',
        description: '방법·팁·비교 등 정보를 체계적으로 정리한 글',
        requiresSource: false, experienceRequired: true,
    },
    {
        id: 'rewrite', label: '원본재작성', group: '재구성형',
        description: '기존 글을 완전히 새로운 표현으로 재작성',
        requiresSource: true, sourceLabel: '원본 글', experienceRequired: false,
    },
    {
        id: 'youtube_based', label: '유튜브기반', group: '재구성형',
        description: '영상 내용을 블로그 글로 재구성',
        requiresSource: true, sourceLabel: '영상 내용 / 스크립트', experienceRequired: false,
    },
    {
        id: 'news_based', label: '뉴스기반', group: '재구성형',
        description: '뉴스 기사를 바탕으로 한 해설·정리 글',
        requiresSource: true, sourceLabel: '뉴스 기사 내용', experienceRequired: false,
    },
    {
        id: 'coupang_promo', label: '쿠팡홍보', group: '홍보형',
        description: '쿠팡 파트너스 상품 홍보글 (대가성 문구 자동 포함)',
        requiresSource: true, sourceLabel: '상품 정보', experienceRequired: false,
    },
    {
        id: 'smartstore_promo', label: '스마트스토어홍보', group: '홍보형',
        description: '스마트스토어 상품·브랜드 홍보글',
        requiresSource: true, sourceLabel: '상품/스토어 정보', experienceRequired: false,
    },
];

export function findCategory(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
}
