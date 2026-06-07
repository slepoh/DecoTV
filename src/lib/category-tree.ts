import type { AdminConfig } from './admin.types';

export interface CategoryOption {
  label: string;
  value: string;
}

export interface CategoryFilterGroup {
  key: string;
  label: string;
  options: CategoryOption[];
}

export interface ContentCategorySchema {
  key: string;
  label: string;
  primary: CategoryOption[];
  secondary: Record<string, CategoryOption[]>;
  filters: CategoryFilterGroup[];
}

export interface CategoryTreePayload {
  version: 1;
  generatedAt: string;
  categories: ContentCategorySchema[];
  custom: Array<{
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }>;
}

function buildYearOptions(): CategoryOption[] {
  const currentYear = new Date().getFullYear();
  const currentYears = Array.from(
    { length: Math.max(currentYear - 2020 + 1, 1) },
    (_, index) => currentYear - index,
  ).map((year) => ({ label: String(year), value: String(year) }));

  return [
    { label: '全部', value: 'all' },
    { label: '2020年代', value: '2020s' },
    ...currentYears,
    { label: '2010年代', value: '2010s' },
    { label: '2000年代', value: '2000s' },
    { label: '90年代', value: '1990s' },
    { label: '80年代', value: '1980s' },
    { label: '70年代', value: '1970s' },
    { label: '60年代', value: '1960s' },
    { label: '更早', value: 'earlier' },
  ];
}

const movieGenreOptions: CategoryOption[] = [
  { label: '全部', value: 'all' },
  { label: '喜剧', value: 'comedy' },
  { label: '爱情', value: 'romance' },
  { label: '动作', value: 'action' },
  { label: '科幻', value: 'sci-fi' },
  { label: '悬疑', value: 'suspense' },
  { label: '犯罪', value: 'crime' },
  { label: '惊悚', value: 'thriller' },
  { label: '冒险', value: 'adventure' },
  { label: '音乐', value: 'music' },
  { label: '历史', value: 'history' },
  { label: '奇幻', value: 'fantasy' },
  { label: '恐怖', value: 'horror' },
  { label: '战争', value: 'war' },
  { label: '纪录片', value: 'documentary' },
];

const tvGenreOptions: CategoryOption[] = [
  { label: '全部', value: 'all' },
  { label: '喜剧', value: 'comedy' },
  { label: '爱情', value: 'romance' },
  { label: '悬疑', value: 'suspense' },
  { label: '武侠', value: 'wuxia' },
  { label: '古装', value: 'costume' },
  { label: '家庭', value: 'family' },
  { label: '犯罪', value: 'crime' },
  { label: '科幻', value: 'sci-fi' },
  { label: '历史', value: 'history' },
  { label: '战争', value: 'war' },
  { label: '动作', value: 'action' },
  { label: '剧情', value: 'drama' },
  { label: '奇幻', value: 'fantasy' },
];

const regionOptions: CategoryOption[] = [
  { label: '全部', value: 'all' },
  { label: '华语', value: 'chinese' },
  { label: '欧美', value: 'western' },
  { label: '韩国', value: 'korean' },
  { label: '日本', value: 'japanese' },
  { label: '中国大陆', value: 'mainland_china' },
  { label: '美国', value: 'usa' },
  { label: '中国香港', value: 'hong_kong' },
  { label: '中国台湾', value: 'taiwan' },
  { label: '英国', value: 'uk' },
  { label: '法国', value: 'france' },
  { label: '德国', value: 'germany' },
  { label: '泰国', value: 'thailand' },
];

const platformOptions: CategoryOption[] = [
  { label: '全部', value: 'all' },
  { label: '腾讯视频', value: 'tencent' },
  { label: '爱奇艺', value: 'iqiyi' },
  { label: '优酷', value: 'youku' },
  { label: '湖南卫视', value: 'hunan_tv' },
  { label: 'Netflix', value: 'netflix' },
  { label: 'HBO', value: 'hbo' },
  { label: 'BBC', value: 'bbc' },
];

const sortOptions: CategoryOption[] = [
  { label: '综合排序', value: 'T' },
  { label: '近期热度', value: 'U' },
  { label: '时间优先', value: 'R' },
  { label: '高分优先', value: 'S' },
];

function buildFilters(
  genreOptions: CategoryOption[],
  withPlatform: boolean,
): CategoryFilterGroup[] {
  return [
    { key: 'type', label: '类型', options: genreOptions },
    { key: 'region', label: '地区', options: regionOptions },
    { key: 'year', label: '年份', options: buildYearOptions() },
    ...(withPlatform
      ? [{ key: 'platform', label: '平台', options: platformOptions }]
      : []),
    { key: 'sort', label: '排序', options: sortOptions },
  ];
}

export function buildCategoryTree(config: AdminConfig): CategoryTreePayload {
  const custom = (config.CustomCategories || [])
    .filter((category) => !category.disabled)
    .map((category) => ({
      name: category.name || category.query,
      type: category.type,
      query: category.query,
    }));

  const customByType = custom.reduce<Record<'movie' | 'tv', CategoryOption[]>>(
    (acc, category) => {
      acc[category.type].push({
        label: category.name || category.query,
        value: category.query,
      });
      return acc;
    },
    { movie: [], tv: [] },
  );

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    custom,
    categories: [
      {
        key: 'movie',
        label: '电影',
        primary: [
          { label: '全部', value: '全部' },
          { label: '热门电影', value: '热门' },
          { label: '最新电影', value: '最新' },
          { label: '豆瓣高分', value: '豆瓣高分' },
          { label: '冷门佳片', value: '冷门佳片' },
          ...(customByType.movie.length > 0
            ? [{ label: '自定义片单', value: 'custom' }]
            : []),
        ],
        secondary: {
          全部: [{ label: '全部', value: '全部' }],
          热门: [
            { label: '全部', value: '全部' },
            { label: '华语', value: '华语' },
            { label: '欧美', value: '欧美' },
            { label: '韩国', value: '韩国' },
            { label: '日本', value: '日本' },
          ],
          最新: [{ label: '全部', value: '全部' }],
          豆瓣高分: [{ label: '全部', value: '全部' }],
          冷门佳片: [{ label: '全部', value: '全部' }],
          custom: customByType.movie,
        },
        filters: buildFilters(movieGenreOptions, false),
      },
      {
        key: 'tv',
        label: '电视剧',
        primary: [
          { label: '全部', value: '全部' },
          { label: '最近热门', value: '最近热门' },
          ...(customByType.tv.length > 0
            ? [{ label: '自定义片单', value: 'custom' }]
            : []),
        ],
        secondary: {
          全部: [{ label: '全部', value: 'tv' }],
          最近热门: [
            { label: '全部', value: 'tv' },
            { label: '国产', value: 'tv_domestic' },
            { label: '欧美', value: 'tv_american' },
            { label: '日本', value: 'tv_japanese' },
            { label: '韩国', value: 'tv_korean' },
            { label: '动漫', value: 'tv_animation' },
            { label: '纪录片', value: 'tv_documentary' },
          ],
          custom: customByType.tv,
        },
        filters: buildFilters(tvGenreOptions, true),
      },
      {
        key: 'show',
        label: '综艺',
        primary: [
          { label: '全部', value: '全部' },
          { label: '最近热门', value: '最近热门' },
        ],
        secondary: {
          全部: [{ label: '全部', value: 'show' }],
          最近热门: [
            { label: '全部', value: 'show' },
            { label: '国内', value: 'show_domestic' },
            { label: '国外', value: 'show_foreign' },
          ],
        },
        filters: buildFilters(
          [
            { label: '全部', value: 'all' },
            { label: '真人秀', value: 'reality' },
            { label: '脱口秀', value: 'talkshow' },
            { label: '音乐', value: 'music' },
            { label: '歌舞', value: 'musical' },
          ],
          true,
        ),
      },
      {
        key: 'anime',
        label: '动漫',
        primary: [
          { label: '每日放送', value: '每日放送' },
          { label: '番剧', value: '番剧' },
          { label: '剧场版', value: '剧场版' },
        ],
        secondary: {
          每日放送: [{ label: '全部', value: '全部' }],
          番剧: [{ label: '全部', value: '全部' }],
          剧场版: [{ label: '全部', value: '全部' }],
        },
        filters: buildFilters(
          [
            { label: '全部', value: 'all' },
            { label: '国漫', value: 'chinese_anime' },
            { label: '治愈', value: 'healing' },
            { label: '运动', value: 'sports' },
            { label: '悬疑', value: 'suspense' },
            { label: '恋爱', value: 'love' },
            { label: '科幻', value: 'sci_fi' },
          ],
          true,
        ),
      },
    ],
  };
}
