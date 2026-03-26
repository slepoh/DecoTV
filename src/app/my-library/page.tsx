'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

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
  connectorName: string;
  sourceItemId: string;
  season?: number;
  episode?: number;
  overview?: string;
}

interface LibraryErrorItem {
  connectorId: string;
  connectorName: string;
  error: string;
}

function LibrarySkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className='overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
        >
          <div className='aspect-2/3 animate-pulse bg-gray-200 dark:bg-gray-800' />
          <div className='space-y-2 p-3'>
            <div className='h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-3 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
            <div className='h-7 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MyLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectorErrors, setConnectorErrors] = useState<LibraryErrorItem[]>(
    [],
  );

  const grouped = useMemo(() => {
    const movies = items.filter((item) => item.mediaType === 'movie');
    const tv = items.filter((item) => item.mediaType === 'tv');
    return { movies, tv };
  }, [items]);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    setConnectorErrors([]);

    try {
      const resp = await fetch('/api/private-library/items', {
        cache: 'no-store',
      });
      const data = (await resp.json()) as {
        items?: LibraryItem[];
        errors?: LibraryErrorItem[];
        error?: string;
        details?: string;
      };

      if (!resp.ok) {
        throw new Error(data.error || data.details || '读取私人影库失败');
      }

      setItems(data.items || []);
      setConnectorErrors(data.errors || []);
      if ((data.items?.length || 0) === 0 && (data.errors?.length || 0) > 0) {
        setError(data.errors?.[0]?.error || '私人影库当前不可用');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取私人影库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const renderCard = (item: LibraryItem) => {
    const playUrl = `/play?source=private_library&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&year=${encodeURIComponent(item.year ? String(item.year) : '')}&stitle=${encodeURIComponent(item.title)}&stype=${encodeURIComponent(item.mediaType)}&connectorId=${encodeURIComponent(item.connectorId)}&sourceItemId=${encodeURIComponent(item.sourceItemId)}`;

    return (
      <div
        key={item.id}
        className='overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
      >
        <div className='relative aspect-2/3 bg-gray-100 dark:bg-gray-800'>
          <ExternalImage
            src={item.poster || POSTER_FALLBACK_SRC}
            alt={item.title}
            fill
            className='object-cover'
            sizes='(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw'
            fallbackSrc={POSTER_FALLBACK_SRC}
          />
        </div>
        <div className='space-y-1 p-3'>
          <div className='line-clamp-2 text-sm font-medium'>{item.title}</div>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            {item.connectorName}
            {item.year ? ` · ${item.year}` : ''}
            {item.season && item.episode
              ? ` · S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
              : ''}
          </div>
          <Link
            href={playUrl}
            className='mt-2 inline-flex rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700'
          >
            在 DecoTV 播放
          </Link>
        </div>
      </div>
    );
  };

  return (
    <PageLayout>
      <main className='mx-auto max-w-7xl space-y-8 px-4 pb-24 pt-24'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-bold'>我的影库</h1>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              浏览你接入的 OpenList、Emby 或 Jellyfin 私有媒体资源。
            </p>
          </div>
          <button
            type='button'
            onClick={() => void fetchItems()}
            className='inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600'
          >
            <RefreshCw className='h-4 w-4' />
            刷新
          </button>
        </div>

        {loading ? <LibrarySkeleton /> : null}

        {!loading && error ? (
          <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'>
            <p className='font-medium'>私人影库暂时不可用</p>
            <p className='mt-1'>{error}</p>
            <p className='mt-2 text-xs opacity-80'>
              可以前往后台检查连接状态、重新扫描或确认服务端仍然在线。
            </p>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <div className='rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'>
            <p className='font-medium'>还没有扫描到媒体文件</p>
            <p className='mt-2'>
              请在后台配置私人影库连接后重新扫描。OpenList 建议按
              <span className='mx-1 font-mono'>
                电影名 (年份) {'{tmdb-123456}'}
              </span>
              或
              <span className='mx-1 font-mono'>
                剧名 (年份) {'{tmdb-123456}'}
              </span>
              的目录格式整理文件。
            </p>
            <Link
              href='/admin'
              className='mt-4 inline-flex rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700'
            >
              前往后台配置
            </Link>
          </div>
        ) : null}

        {!loading &&
        !error &&
        connectorErrors.length > 0 &&
        items.length > 0 ? (
          <div className='rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'>
            <p className='font-medium'>部分连接当前不可用</p>
            <div className='mt-2 space-y-1'>
              {connectorErrors.map((item) => (
                <p key={item.connectorId}>
                  {item.connectorName}：{item.error}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {grouped.movies.length > 0 ? (
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>电影</h2>
            <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'>
              {grouped.movies.map(renderCard)}
            </div>
          </section>
        ) : null}

        {grouped.tv.length > 0 ? (
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>剧集</h2>
            <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'>
              {grouped.tv.map(renderCard)}
            </div>
          </section>
        ) : null}
      </main>
    </PageLayout>
  );
}
