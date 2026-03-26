'use client';

import { Loader2, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { POSTER_FALLBACK_SRC } from '@/lib/image-url';

import ExternalImage from '@/components/ExternalImage';
import PageLayout from '@/components/PageLayout';

interface LibraryItem {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  poster: string;
  connectorId: string;
  connectorType: 'openlist' | 'emby' | 'jellyfin';
  connectorName: string;
  connectorSourceName: string;
  sourceItemId: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
}

interface LibraryErrorItem {
  connectorId: string;
  connectorName: string;
  error: string;
}

interface LibraryCategoryItem {
  key: string;
  label: string;
  count: number;
}

interface PaginationPayload {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
}

const PAGE_SIZE = 24;

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

function defaultPagination(): PaginationPayload {
  return {
    total: 0,
    offset: 0,
    limit: PAGE_SIZE,
    hasMore: false,
    nextOffset: PAGE_SIZE,
  };
}

export default function MyLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [categories, setCategories] = useState<LibraryCategoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [connectorErrors, setConnectorErrors] = useState<LibraryErrorItem[]>(
    [],
  );
  const [pagination, setPagination] =
    useState<PaginationPayload>(defaultPagination());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchKeyword(keyword.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  const activeSummary = useMemo(() => {
    const current = categories.find((item) => item.key === selectedCategory);
    return current
      ? `${current.label} · ${current.count}`
      : `全部 · ${pagination.total}`;
  }, [categories, pagination.total, selectedCategory]);

  const fetchItems = useCallback(
    async ({
      append = false,
      offset = 0,
    }: {
      append?: boolean;
      offset?: number;
    } = {}) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');
      setConnectorErrors([]);

      try {
        const query = new URLSearchParams();
        query.set('offset', String(offset));
        query.set('limit', String(PAGE_SIZE));
        query.set('category', selectedCategory);
        if (searchKeyword) {
          query.set('q', searchKeyword);
        }

        const resp = await fetch(
          `/api/private-library/items?${query.toString()}`,
          {
            cache: 'no-store',
          },
        );
        const data = (await resp.json()) as {
          items?: LibraryItem[];
          categories?: LibraryCategoryItem[];
          pagination?: PaginationPayload;
          errors?: LibraryErrorItem[];
          error?: string;
          details?: string;
        };

        if (!resp.ok) {
          throw new Error(data.error || data.details || '读取私人影库失败');
        }

        setItems((current) =>
          append ? [...current, ...(data.items || [])] : data.items || [],
        );
        setCategories(data.categories || []);
        setPagination(data.pagination || defaultPagination());
        setConnectorErrors(data.errors || []);
        if ((data.items?.length || 0) === 0 && (data.errors?.length || 0) > 0) {
          setError(data.errors?.[0]?.error || '私人影库当前不可用');
        }
      } catch (currentError) {
        setError(
          currentError instanceof Error
            ? currentError.message
            : '读取私人影库失败',
        );
        if (!append) {
          setItems([]);
          setPagination(defaultPagination());
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [searchKeyword, selectedCategory],
  );

  useEffect(() => {
    void fetchItems({ append: false, offset: 0 });
  }, [fetchItems]);

  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      categories.length > 0 &&
      !categories.some((item) => item.key === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [categories, selectedCategory]);

  const renderCard = (item: LibraryItem) => {
    const playUrl = `/play?source=private_library&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&year=${encodeURIComponent(item.year ? String(item.year) : '')}&stitle=${encodeURIComponent(item.title)}&stype=${encodeURIComponent(item.mediaType)}&connectorId=${encodeURIComponent(item.connectorId)}&sourceItemId=${encodeURIComponent(item.sourceItemId)}`;
    const metaLine = [
      item.year ? String(item.year) : '',
      item.season && item.episode
        ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
        : '',
      item.libraryName || '',
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <div
        key={`${item.connectorId}-${item.sourceItemId}`}
        className='group overflow-hidden rounded-2xl border border-white/10 bg-slate-900/72 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.8)] transition-all hover:border-emerald-300/30 hover:bg-slate-900/86'
      >
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
          <div className='absolute left-3 top-3 inline-flex rounded-full border border-white/10 bg-slate-950/70 px-2 py-1 text-[11px] font-medium text-slate-100 backdrop-blur-sm'>
            {item.connectorSourceName}
          </div>
        </div>

        <div className='space-y-2 p-3'>
          <div className='line-clamp-2 text-sm font-semibold text-slate-100'>
            {item.title}
          </div>

          {metaLine ? (
            <div className='text-xs text-slate-400'>{metaLine}</div>
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

          <Link
            href={playUrl}
            className='mt-2 inline-flex rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500'
          >
            在 DecoTV 播放
          </Link>
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
                浏览已接入的 OpenList、Emby、Jellyfin
                私人媒体资源，支持搜索、分类筛选和渐进加载。
              </p>
            </div>
            <div className='inline-flex rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200'>
              {activeSummary}
            </div>
          </div>

          <div className='mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
            <label className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder='搜索影片名、简介、类型或连接名称...'
                className='h-11 w-full rounded-xl border border-slate-600/60 bg-slate-900/45 pl-10 pr-4 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60'
              />
            </label>
            <button
              type='button'
              onClick={() => void fetchItems({ append: false, offset: 0 })}
              className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600/70 bg-slate-900/45 px-4 py-2.5 text-sm text-slate-100 transition-colors hover:border-emerald-400/50 hover:text-emerald-200'
            >
              <RefreshCw className='h-4 w-4' />
              刷新
            </button>
          </div>
        </section>

        {categories.length > 0 ? (
          <section className='rounded-2xl border border-white/10 bg-slate-900/78 p-4'>
            <div className='flex flex-wrap gap-2'>
              {categories.map((category) => {
                const active = category.key === selectedCategory;
                return (
                  <button
                    key={category.key}
                    type='button'
                    onClick={() => setSelectedCategory(category.key)}
                    className={`rounded-xl border px-3 py-1.5 text-sm transition-all ${
                      active
                        ? 'border-emerald-300/60 bg-emerald-500/20 text-emerald-200'
                        : 'border-slate-600/70 bg-slate-800/50 text-slate-200 hover:border-emerald-400/50'
                    }`}
                  >
                    {category.label}
                    <span className='ml-1 text-xs opacity-80'>
                      {category.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {loading ? <LibrarySkeleton /> : null}

        {!loading && error ? (
          <div className='rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200'>
            <p className='font-medium'>私人影库暂时不可用</p>
            <p className='mt-1'>{error}</p>
            <p className='mt-2 text-xs opacity-80'>
              可以前往后台检查连接状态、重新扫描，或确认上游 Emby / Jellyfin /
              OpenList 服务仍然在线。
            </p>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <div className='rounded-2xl border border-dashed border-slate-600/70 bg-slate-900/55 p-6 text-sm text-slate-300'>
            <p className='font-medium text-slate-100'>
              {searchKeyword || selectedCategory !== 'all'
                ? '当前筛选条件下没有匹配的影片'
                : '还没有扫描到可展示的媒体资源'}
            </p>
            <p className='mt-2'>
              {searchKeyword || selectedCategory !== 'all'
                ? '可以尝试更换分类、缩短关键词，或者返回“全部”重新浏览。'
                : '请在后台完成私人影库连接配置并重新扫描。OpenList 建议按 “片名 (年份) {tmdb-123456}” 的目录结构整理文件，Emby / Jellyfin 建议确认媒体库索引和元数据已正常生成。'}
            </p>
            {!searchKeyword && selectedCategory === 'all' ? (
              <Link
                href='/admin'
                className='mt-4 inline-flex rounded-lg bg-blue-600 px-3 py-2 text-white transition-colors hover:bg-blue-500'
              >
                前往后台配置
              </Link>
            ) : null}
          </div>
        ) : null}

        {!loading &&
        !error &&
        connectorErrors.length > 0 &&
        items.length > 0 ? (
          <div className='rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200'>
            <p className='font-medium'>部分连接当前不可用</p>
            <div className='mt-2 space-y-1 text-xs sm:text-sm'>
              {connectorErrors.map((item) => (
                <p key={item.connectorId}>
                  {item.connectorName}：{item.error}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <>
            <section className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
              {items.map(renderCard)}
            </section>

            <div className='flex flex-col items-center gap-3 pb-4'>
              <p className='text-xs text-slate-400'>
                已显示 {items.length} / {pagination.total} 条结果
              </p>
              {pagination.hasMore ? (
                <button
                  type='button'
                  onClick={() =>
                    void fetchItems({
                      append: true,
                      offset: pagination.nextOffset,
                    })
                  }
                  disabled={loadingMore}
                  className='inline-flex min-w-36 items-center justify-center gap-2 rounded-xl border border-white/20 bg-slate-900/70 px-5 py-2.5 text-sm font-medium text-slate-100 transition hover:border-emerald-300/50 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      正在加载...
                    </>
                  ) : (
                    '加载更多'
                  )}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </PageLayout>
  );
}
