import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  buildPrivateLibraryPosterUrl,
  formatPrivateLibrarySourceName,
  getConnectorCachedItems,
  getPrivateLibraryConfig,
  type PrivateLibraryItem,
  scanConnector,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';
import {
  tmdbGetMovieDetail,
  tmdbGetTvDetail,
  toTmdbPosterUrl,
} from '@/lib/tmdb';

export const runtime = 'nodejs';

interface LibraryItemPayload {
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
  streamPath: string;
  sourceItemId: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
}

interface LibraryCategoryPayload {
  key: string;
  label: string;
  count: number;
}

interface MergedLibraryItem extends PrivateLibraryItem {
  connectorName: string;
  connectorSourceName: string;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const MAX_EXTRA_CATEGORIES = 12;

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toSearchHaystack(item: MergedLibraryItem): string {
  return [
    item.title,
    item.overview,
    item.connectorName,
    item.connectorSourceName,
    item.libraryName,
    ...(item.genres || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function toLibraryLabel(value: string): string {
  const normalized = normalizeText(value);
  if (normalized === 'movies') {
    return '电影库';
  }
  if (normalized === 'tvshows') {
    return '剧集库';
  }
  return value.trim();
}

function matchesCategory(item: MergedLibraryItem, category: string): boolean {
  if (!category || category === 'all') {
    return true;
  }

  if (category === 'media:movie') {
    return item.mediaType === 'movie';
  }

  if (category === 'media:tv') {
    return item.mediaType === 'tv';
  }

  if (category.startsWith('genre:')) {
    const target = normalizeText(category.slice('genre:'.length));
    return (item.genres || []).some((genre) => normalizeText(genre) === target);
  }

  if (category.startsWith('library:')) {
    const target = normalizeText(category.slice('library:'.length));
    return normalizeText(item.libraryName || '') === target;
  }

  return true;
}

function buildCategories(items: MergedLibraryItem[]): LibraryCategoryPayload[] {
  const movieCount = items.filter((item) => item.mediaType === 'movie').length;
  const tvCount = items.filter((item) => item.mediaType === 'tv').length;
  const categories: LibraryCategoryPayload[] = [
    { key: 'all', label: '全部', count: items.length },
    { key: 'media:movie', label: '电影', count: movieCount },
    { key: 'media:tv', label: '剧集', count: tvCount },
  ];

  const libraryCounts = new Map<string, number>();
  for (const item of items) {
    const label = toLibraryLabel(item.libraryName || '');
    const normalized = normalizeText(label);
    if (!label || normalized === '电影库' || normalized === '剧集库') {
      continue;
    }
    libraryCounts.set(label, (libraryCounts.get(label) || 0) + 1);
  }

  Array.from(libraryCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 4)
    .forEach(([label, count]) => {
      categories.push({
        key: `library:${label}`,
        label,
        count,
      });
    });

  const genreCounts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.genres || []) {
      const label = genre.trim();
      if (!label) {
        continue;
      }
      genreCounts.set(label, (genreCounts.get(label) || 0) + 1);
    }
  }

  Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, MAX_EXTRA_CATEGORIES)
    .forEach(([label, count]) => {
      categories.push({
        key: `genre:${label}`,
        label,
        count,
      });
    });

  return categories.filter((item) => item.count > 0);
}

function sortItems(items: MergedLibraryItem[]): MergedLibraryItem[] {
  return [...items].sort((left, right) => {
    const yearDelta = (right.year || 0) - (left.year || 0);
    if (yearDelta !== 0) {
      return yearDelta;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

async function enrichItem(
  item: MergedLibraryItem,
): Promise<LibraryItemPayload> {
  let title = item.title;
  let poster =
    item.connectorType === 'openlist'
      ? ''
      : buildPrivateLibraryPosterUrl(item.connectorId, item.sourceItemId);
  let overview = item.overview || '';
  let genres = item.genres || [];

  if (item.tmdbId) {
    try {
      if (item.mediaType === 'movie') {
        const detail = await tmdbGetMovieDetail(item.tmdbId);
        title = detail.title || title;
        poster = toTmdbPosterUrl(detail.poster_path) || poster;
        overview = detail.overview || overview;
        genres =
          genres.length > 0
            ? genres
            : (detail.genres || []).map((genre) => genre.name).filter(Boolean);
      } else {
        const detail = await tmdbGetTvDetail(item.tmdbId);
        title = detail.name || title;
        poster = toTmdbPosterUrl(detail.poster_path) || poster;
        overview = detail.overview || overview;
        genres =
          genres.length > 0
            ? genres
            : (detail.genres || []).map((genre) => genre.name).filter(Boolean);
      }
    } catch {
      // TMDB 补充失败时保留已有字段。
    }
  }

  return {
    id: item.id,
    title,
    year: item.year,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    poster,
    connectorId: item.connectorId,
    connectorType: item.connectorType,
    connectorName: item.connectorName,
    connectorSourceName: item.connectorSourceName,
    streamPath: item.streamPath,
    sourceItemId: item.sourceItemId,
    season: item.season,
    episode: item.episode,
    overview,
    genres,
    libraryName: item.libraryName,
  };
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectorIdFilter = (searchParams.get('connectorId') || '').trim();
    const mediaTypeFilter = (searchParams.get('mediaType') || '').trim();
    const query = (searchParams.get('q') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const offset = parsePositiveInt(searchParams.get('offset'), 0, 10_000);
    const limit = parsePositiveInt(
      searchParams.get('limit'),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const cfg = await getPrivateLibraryConfig();
    const enabled = cfg.connectors.filter(
      (item) =>
        item.enabled && (!connectorIdFilter || item.id === connectorIdFilter),
    );
    const merged: MergedLibraryItem[] = [];
    const errors: Array<{
      connectorId: string;
      connectorName: string;
      error: string;
    }> = [];

    for (const connector of enabled) {
      let items = getConnectorCachedItems(connector.id);

      if (items.length === 0) {
        try {
          items = await scanConnector(connector);
        } catch (error) {
          errors.push({
            connectorId: connector.id,
            connectorName: connector.name,
            error: toPrivateLibraryErrorMessage(error),
          });
          continue;
        }
      }

      for (const item of items) {
        merged.push({
          ...item,
          connectorName: connector.name,
          connectorSourceName: formatPrivateLibrarySourceName(connector),
        });
      }
    }

    const normalizedQuery = normalizeText(query);
    const queryFiltered = sortItems(
      merged.filter((item) => {
        if (
          mediaTypeFilter &&
          mediaTypeFilter !== 'all' &&
          item.mediaType !== mediaTypeFilter
        ) {
          return false;
        }

        if (
          normalizedQuery &&
          !toSearchHaystack(item).includes(normalizedQuery)
        ) {
          return false;
        }

        return true;
      }),
    );

    const categories = buildCategories(queryFiltered);
    const activeCategory =
      category ||
      (mediaTypeFilter && mediaTypeFilter !== 'all'
        ? `media:${mediaTypeFilter}`
        : 'all');
    const filtered = queryFiltered.filter((item) =>
      matchesCategory(item, activeCategory),
    );

    const pageItems = filtered.slice(offset, offset + limit);
    const items = await Promise.all(pageItems.map((item) => enrichItem(item)));

    return NextResponse.json({
      items,
      categories,
      pagination: {
        total: filtered.length,
        offset,
        limit,
        hasMore: offset + items.length < filtered.length,
        nextOffset: offset + items.length,
      },
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '读取私人影库资源失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
