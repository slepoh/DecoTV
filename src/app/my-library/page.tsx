'use client';

import { Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { POSTER_FALLBACK_SRC } from '@/lib/image-url';

import ExternalImage from '@/components/ExternalImage';
import PageLayout from '@/components/PageLayout';

type ConnectorType = 'openlist' | 'emby' | 'jellyfin' | 'xiaoya';
type LibraryFilterType = 'all' | 'movie' | 'tv' | 'anime';
type SortMode = 'recent' | 'title' | 'year' | 'rating';

interface LibraryItem {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  poster: string;
  connectorId: string;
  connectorType: ConnectorType;
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
  sourceItemId: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
  originalLanguage?: string;
  tmdbRating?: number;
  runtimeMinutes?: number;
  episodeCount?: number;
  seasonCount?: number;
  isAnime?: boolean;
  scannedAt: number;
  sortKey: number;
}

interface LibraryConnector {
  id: string;
  name: string;
  displayName?: string;
  type: ConnectorType;
  typeLabel: string;
}

interface LibraryErrorItem {
  connectorId: string;
  connectorName: string;
  error: string;
}

interface PaginationPayload {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
}

const PAGE_SIZE = 24;

const SOURCE_BADGE_STYLES: Record<ConnectorType, string> = {
  xiaoya:
    'border-violet-300/35 bg-violet-500/80 text-violet-50 shadow-[0_8px_24px_-16px_rgba(139,92,246,0.9)]',
  openlist:
    'border-teal-300/35 bg-teal-500/80 text-teal-50 shadow-[0_8px_24px_-16px_rgba(20,184,166,0.9)]',
  emby: 'border-sky-300/35 bg-sky-500/80 text-sky-50 shadow-[0_8px_24px_-16px_rgba(14,165,233,0.9)]',
  jellyfin:
    'border-sky-300/35 bg-sky-500/80 text-sky-50 shadow-[0_8px_24px_-16px_rgba(14,165,233,0.9)]',
};

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
};

function LibrarySkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className='overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70'
        >
          <div className='aspect-2/3 animate-pulse bg-slate-800/80' />
          <div className='space-y-2 p-3'>
            <div className='h-4 animate-pulse rounded bg-slate-800/80' />
            <div className='h-3 w-2/3 animate-pulse rounded bg-slate-800/70' />
            <div className='h-3 w-1/2 animate-pulse rounded bg-slate-800/70' />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function filterTypeLabel(item: LibraryItem): LibraryFilterType {
  if (item.isAnime) {
    return 'anime';
  }
  return item.mediaType;
}

function mediaTypeLabel(item: LibraryItem): string {
  if (item.isAnime) {
    return '动漫';
  }
  return item.mediaType === 'movie' ? '电影' : '剧集';
}

function buildSearchHaystack(item: LibraryItem): string {
  return [
    item.title,
    item.overview,
    item.libraryName,
    item.connectorSourceName,
    item.connectorName,
    ...(item.genres || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatSourceLabel(item: LibraryItem): string {
  return item.connectorSourceName;
}

function toSortLabel(mode: SortMode): string {
  switch (mode) {
    case 'title':
      return '按名称 A-Z';
    case 'year':
      return '按年份最新';
    case 'rating':
      return '按 TMDB 评分最高';
    default:
      return '最近扫描到';
  }
}

export default function MyLibraryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [connectors, setConnectors] = useState<LibraryConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [connectorErrors, setConnectorErrors] = useState<LibraryErrorItem[]>(
    [],
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [keyword, setKeyword] = useState(searchParams.get('q') || '');

  const sourceFilter = searchParams.get('source') || 'all';
  const typeFilter = (searchParams.get('type') || 'all') as LibraryFilterType;
  const yearFilter = searchParams.get('year') || 'all';
  const languageFilter = searchParams.get('language') || 'all';
  const sortFilter = (searchParams.get('sort') || 'recent') as SortMode;

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());

      Object.entries(patch).forEach(([key, value]) => {
        if (!value || value === 'all' || value === 'recent') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });

      const queryString = next.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    setKeyword(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateQuery({ q: keyword.trim() || null });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword, updateQuery]);

  const fetchItems = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError('');
      const query = new URLSearchParams();
      query.set('all', '1');
      if (forceRefresh) {
        query.set('refresh', '1');
      }

      const resp = await fetch(`/api/private-library/items?${query}`, {
        cache: 'no-store',
      });
      const data = (await resp.json()) as {
        items?: LibraryItem[];
        connectors?: LibraryConnector[];
        errors?: LibraryErrorItem[];
        error?: string;
        details?: string;
        pagination?: PaginationPayload;
      };

      if (!resp.ok) {
        throw new Error(data.error || data.details || '读取私人影库失败');
      }

      setItems(data.items || []);
      setConnectors(data.connectors || []);
      setConnectorErrors(data.errors || []);
    } catch (currentError) {
      setItems([]);
      setConnectors([]);
      setConnectorErrors([]);
      setError(
        currentError instanceof Error
          ? currentError.message
          : '读取私人影库失败',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems(false);
  }, [fetchItems]);

  const sourceOptions = useMemo(() => {
    if (connectors.length <= 1) {
      return [];
    }

    return connectors.map((connector) => ({
      value: connector.id,
      label: connector.displayName?.trim() || connector.typeLabel,
      type: connector.type,
    }));
  }, [connectors]);

  const yearOptions = useMemo(() => {
    return Array.from(
      new Set(
        items
          .map((item) => item.year)
          .filter((year): year is number => Number.isFinite(year || NaN)),
      ),
    ).sort((left, right) => right - left);
  }, [items]);

  const languageOptions = useMemo(() => {
    return Object.entries(LANGUAGE_LABELS).filter(([code]) =>
      items.some((item) => normalizeText(item.originalLanguage || '') === code),
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const keywordQuery = normalizeText(searchParams.get('q') || '');

    const next = items
      .filter((item) => {
        if (
          sourceFilter !== 'all' &&
          item.connectorId !== sourceFilter &&
          item.connectorType !== sourceFilter
        ) {
          return false;
        }

        if (typeFilter !== 'all' && filterTypeLabel(item) !== typeFilter) {
          return false;
        }

        if (yearFilter !== 'all' && String(item.year || '') !== yearFilter) {
          return false;
        }

        if (
          languageFilter !== 'all' &&
          normalizeText(item.originalLanguage || '') !== languageFilter
        ) {
          return false;
        }

        if (keywordQuery && !buildSearchHaystack(item).includes(keywordQuery)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        switch (sortFilter) {
          case 'title':
            return left.title.localeCompare(right.title, 'zh-CN');
          case 'year':
            return (right.year || 0) - (left.year || 0);
          case 'rating':
            return (right.tmdbRating || 0) - (left.tmdbRating || 0);
          default:
            if (right.scannedAt !== left.scannedAt) {
              return right.scannedAt - left.scannedAt;
            }
            return left.sortKey - right.sortKey;
        }
      });

    return next;
  }, [
    items,
    languageFilter,
    searchParams,
    sortFilter,
    sourceFilter,
    typeFilter,
    yearFilter,
  ]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    sourceFilter,
    typeFilter,
    yearFilter,
    languageFilter,
    sortFilter,
    searchParams,
  ]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );

  const activeSourceName = useMemo(() => {
    if (sourceFilter === 'all') {
      return '全部来源';
    }

    const connector = connectors.find(
      (item) => item.id === sourceFilter || item.type === sourceFilter,
    );
    return connector?.displayName?.trim() || connector?.typeLabel || '当前来源';
  }, [connectors, sourceFilter]);

  const activeTypeLabel = useMemo(() => {
    switch (typeFilter) {
      case 'movie':
        return '电影';
      case 'tv':
        return '剧集';
      case 'anime':
        return '动漫';
      default:
        return '内容';
    }
  }, [typeFilter]);

  const summary = useMemo(() => {
    return `${filteredItems.length} 部资源 · ${toSortLabel(sortFilter)}`;
  }, [filteredItems.length, sortFilter]);

  const clearFilters = () => {
    updateQuery({
      source: null,
      type: null,
      year: null,
      language: null,
      sort: null,
      q: null,
    });
  };

  const renderCard = (item: LibraryItem) => {
    const playUrl = `/play?source=private_library&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&year=${encodeURIComponent(item.year ? String(item.year) : '')}&stitle=${encodeURIComponent(item.title)}&stype=${encodeURIComponent(item.mediaType)}&connectorId=${encodeURIComponent(item.connectorId)}&sourceItemId=${encodeURIComponent(item.sourceItemId)}`;
    const metaInfo = [
      item.tmdbRating ? `TMDB ${item.tmdbRating.toFixed(1)}` : '',
      item.year ? String(item.year) : '',
      item.mediaType === 'tv'
        ? item.episodeCount
          ? `${item.episodeCount} 集`
          : ''
        : item.runtimeMinutes
          ? `${item.runtimeMinutes} 分钟`
          : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <div
        key={`${item.connectorId}-${item.sourceItemId}`}
        className='group overflow-hidden rounded-2xl border border-white/10 bg-slate-900/72 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.8)] transition-all hover:border-emerald-300/30 hover:bg-slate-900/86'
      >
        <Link href={playUrl} className='block'>
          <div className='relative aspect-2/3 bg-slate-800/70'>
            <ExternalImage
              src={item.poster || POSTER_FALLBACK_SRC}
              alt={item.title}
              fill
              className='object-cover transition-transform duration-300 group-hover:scale-[1.02]'
              sizes='(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw'
              fallbackSrc={POSTER_FALLBACK_SRC}
            />
            <div className='pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-slate-950 via-slate-950/45 to-transparent' />
            <div
              className={`absolute left-3 top-3 inline-flex max-w-[60%] truncate rounded-full border px-2 py-1 text-[11px] font-semibold backdrop-blur-sm ${SOURCE_BADGE_STYLES[item.connectorType]}`}
              title={formatSourceLabel(item)}
            >
              {formatSourceLabel(item)}
            </div>
            <div className='absolute right-3 top-3 inline-flex rounded-full border border-white/15 bg-slate-950/70 px-2 py-1 text-[11px] font-medium text-slate-100 backdrop-blur-sm'>
              {mediaTypeLabel(item)}
            </div>
            <div className='absolute inset-x-0 bottom-0 hidden translate-y-2 px-3 pb-3 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 md:block'>
              {metaInfo ? (
                <div className='rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 backdrop-blur'>
                  {metaInfo}
                </div>
              ) : null}
            </div>
          </div>
        </Link>

        <div className='space-y-2 p-3'>
          <div className='line-clamp-2 text-sm font-semibold text-slate-100'>
            {item.title}
          </div>

          {metaInfo ? (
            <div className='text-xs text-slate-400 md:hidden'>{metaInfo}</div>
          ) : null}

          {item.libraryName ? (
            <div className='text-xs text-slate-400'>{item.libraryName}</div>
          ) : null}

          {item.genres && item.genres.length > 0 ? (
            <div className='flex flex-wrap gap-1.5'>
              {item.genres.slice(0, 3).map((genre) => (
                <span
                  key={`${item.id}-${genre}`}
                  className='inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200'
                >
                  {genre}
                </span>
              ))}
            </div>
          ) : null}

          {item.overview ? (
            <p className='line-clamp-2 text-xs leading-5 text-slate-400'>
              {item.overview}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <PageLayout activePath='/my-library'>
      <main className='mx-auto max-w-7xl space-y-6 px-4 pb-24 pt-24 sm:px-6'>
        <section className='rounded-3xl border border-emerald-400/20 bg-linear-to-r from-slate-900/92 via-slate-900/88 to-emerald-950/70 p-5 shadow-[0_16px_48px_-30px_rgba(16,185,129,0.55)] sm:p-6'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <h1 className='text-2xl font-extrabold tracking-tight text-emerald-300'>
                我的影库
              </h1>
              <p className='mt-1 text-sm text-slate-300/90'>
                聚合已接入的 OpenList、小雅 Alist、Emby、Jellyfin 私有媒体资源。
              </p>
            </div>
            <div className='inline-flex rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200'>
              {summary}
            </div>
          </div>

          <div className='mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
            <label className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder='搜索片名、简介、类型或来源...'
                className='h-11 w-full rounded-xl border border-slate-600/60 bg-slate-900/45 pl-10 pr-4 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60'
              />
            </label>
            <button
              type='button'
              onClick={() => void fetchItems(true)}
              className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600/70 bg-slate-900/45 px-4 py-2.5 text-sm text-slate-100 transition-colors hover:border-emerald-400/50 hover:text-emerald-200'
            >
              {refreshing ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw className='h-4 w-4' />
              )}
              刷新影库
            </button>
          </div>
        </section>

        <section className='rounded-2xl border border-white/10 bg-slate-900/78 p-4'>
          <div className='flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400'>
            <SlidersHorizontal className='h-4 w-4' />
            筛选与排序
          </div>

          {sourceOptions.length > 0 ? (
            <div className='mt-4 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => updateQuery({ source: null })}
                className={`rounded-xl border px-3 py-1.5 text-sm transition-all ${
                  sourceFilter === 'all'
                    ? 'border-emerald-300/60 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/10 bg-slate-900/55 text-slate-300 hover:border-emerald-300/30 hover:text-emerald-200'
                }`}
              >
                全部来源
              </button>
              {sourceOptions.map((source) => (
                <button
                  key={source.value}
                  type='button'
                  onClick={() => updateQuery({ source: source.value })}
                  className={`rounded-xl border px-3 py-1.5 text-sm transition-all ${
                    sourceFilter === source.value
                      ? 'border-emerald-300/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/10 bg-slate-900/55 text-slate-300 hover:border-emerald-300/30 hover:text-emerald-200'
                  }`}
                >
                  {source.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className='mt-4 flex flex-wrap gap-2'>
            {(
              [
                ['all', '全部'],
                ['movie', '电影'],
                ['tv', '剧集'],
                ['anime', '动漫'],
              ] as Array<[LibraryFilterType, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type='button'
                onClick={() =>
                  updateQuery({ type: value === 'all' ? null : value })
                }
                className={`rounded-xl border px-3 py-1.5 text-sm transition-all ${
                  typeFilter === value
                    ? 'border-emerald-300/60 bg-emerald-500/20 text-emerald-200'
                    : 'border-white/10 bg-slate-900/55 text-slate-300 hover:border-emerald-300/30 hover:text-emerald-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className='mt-4 grid gap-3 md:grid-cols-3'>
            <select
              value={yearFilter}
              onChange={(event) =>
                updateQuery({
                  year:
                    event.target.value === 'all' ? null : event.target.value,
                })
              }
              className='h-11 rounded-xl border border-slate-600/60 bg-slate-900/45 px-4 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60'
            >
              <option value='all'>全部年份</option>
              {yearOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={languageFilter}
              onChange={(event) =>
                updateQuery({
                  language:
                    event.target.value === 'all' ? null : event.target.value,
                })
              }
              className='h-11 rounded-xl border border-slate-600/60 bg-slate-900/45 px-4 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60'
            >
              <option value='all'>全部语言</option>
              {languageOptions.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={sortFilter}
              onChange={(event) =>
                updateQuery({
                  sort:
                    event.target.value === 'recent' ? null : event.target.value,
                })
              }
              className='h-11 rounded-xl border border-slate-600/60 bg-slate-900/45 px-4 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60'
            >
              <option value='recent'>最近扫描到</option>
              <option value='title'>按名称 A-Z</option>
              <option value='year'>按年份最新</option>
              <option value='rating'>按 TMDB 评分最高</option>
            </select>
          </div>
        </section>

        {loading ? <LibrarySkeleton /> : null}

        {!loading && error ? (
          <section className='rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-5 text-sm text-red-100'>
            {error}
          </section>
        ) : null}

        {!loading && connectorErrors.length > 0 ? (
          <section className='rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-5 text-sm text-amber-100'>
            <div className='font-semibold'>部分连接加载失败</div>
            <div className='mt-2 space-y-1 text-amber-50/90'>
              {connectorErrors.map((item) => (
                <p key={item.connectorId}>
                  {item.connectorName}：{item.error}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        {!loading && !error && filteredItems.length === 0 ? (
          <section className='rounded-3xl border border-dashed border-white/10 bg-slate-900/72 px-6 py-10 text-center'>
            <p className='text-lg font-semibold text-slate-100'>
              在 {activeSourceName} 中没有找到符合条件的 {activeTypeLabel}
            </p>
            <p className='mt-2 text-sm text-slate-400'>
              可以尝试清除筛选条件，或前往后台重新扫描私人影库连接。
            </p>
            <div className='mt-4 flex justify-center gap-3'>
              <button
                type='button'
                onClick={clearFilters}
                className='rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition-colors hover:bg-emerald-500/20'
              >
                清除筛选
              </button>
              <Link
                href='/admin'
                className='rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-300/30 hover:text-emerald-200'
              >
                前往后台配置
              </Link>
            </div>
          </section>
        ) : null}

        {!loading && !error && filteredItems.length > 0 ? (
          <>
            <section className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'>
              {visibleItems.map((item) => renderCard(item))}
            </section>

            {visibleCount < filteredItems.length ? (
              <div className='flex justify-center'>
                <button
                  type='button'
                  onClick={() =>
                    setVisibleCount((current) => current + PAGE_SIZE)
                  }
                  className='rounded-xl border border-slate-600/70 bg-slate-900/55 px-5 py-2.5 text-sm text-slate-100 transition-colors hover:border-emerald-400/50 hover:text-emerald-200'
                >
                  加载更多
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </PageLayout>
  );
}
