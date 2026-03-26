import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  formatPrivateLibrarySourceName,
  getConnectorCachedItems,
  getPrivateLibraryConfig,
  getPrivateLibraryConnectorTypeLabel,
  hydratePrivateLibraryItem,
  type PrivateLibraryConnectorType,
  type PrivateLibraryItem,
  scanConnector,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

interface LibraryItemPayload {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  poster: string;
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
  connectorId: string;
  connectorType: PrivateLibraryConnectorType;
  sourceItemId: string;
  streamPath: string;
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

interface ConnectorPayload {
  id: string;
  name: string;
  displayName?: string;
  sourceName: string;
  type: PrivateLibraryConnectorType;
  typeLabel: string;
}

interface ErrorPayload {
  connectorId: string;
  connectorName: string;
  error: string;
}

interface MergedLibraryItem extends PrivateLibraryItem {
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
}

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

function sortItems<
  T extends { scannedAt: number; sortKey: number; title: string },
>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (right.scannedAt !== left.scannedAt) {
      return right.scannedAt - left.scannedAt;
    }

    if (left.sortKey !== right.sortKey) {
      return left.sortKey - right.sortKey;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toSearchHaystack(item: MergedLibraryItem): string {
  return [
    item.title,
    item.searchTitle,
    item.overview,
    item.libraryName,
    item.connectorName,
    item.connectorSourceName,
    ...(item.genres || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectorIdFilter = (searchParams.get('connectorId') || '').trim();
    const forceRefresh = searchParams.get('refresh') === '1';
    const fetchAll = searchParams.get('all') === '1';
    const query = (searchParams.get('q') || '').trim();
    const offset = parsePositiveInt(searchParams.get('offset'), 0, 20_000);
    const limit = parsePositiveInt(searchParams.get('limit'), 60, 5_000);

    const cfg = await getPrivateLibraryConfig();
    const enabled = cfg.connectors.filter(
      (item) =>
        item.enabled && (!connectorIdFilter || item.id === connectorIdFilter),
    );

    const merged: MergedLibraryItem[] = [];
    const connectors: ConnectorPayload[] = [];
    const errors: ErrorPayload[] = [];

    for (const connector of enabled) {
      connectors.push({
        id: connector.id,
        name: connector.name,
        displayName: connector.displayName,
        sourceName: formatPrivateLibrarySourceName(connector),
        type: connector.type,
        typeLabel: getPrivateLibraryConnectorTypeLabel(connector.type),
      });

      let items = forceRefresh ? [] : getConnectorCachedItems(connector.id);
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
          connectorDisplayName: connector.displayName,
          connectorSourceName: formatPrivateLibrarySourceName(connector),
        });
      }
    }

    const normalizedQuery = normalizeText(query);
    const filtered = sortItems(
      merged.filter((item) =>
        normalizedQuery
          ? toSearchHaystack(item).includes(normalizedQuery)
          : true,
      ),
    );
    const pageItems = fetchAll
      ? filtered
      : filtered.slice(offset, offset + limit);
    const items = await Promise.all(
      pageItems.map(async (item) => {
        let hydrated: MergedLibraryItem = item;
        try {
          const hydratedBase = await hydratePrivateLibraryItem(item);
          hydrated = {
            ...item,
            ...hydratedBase,
            connectorName: item.connectorName,
            connectorDisplayName: item.connectorDisplayName,
            connectorSourceName: item.connectorSourceName,
          };
        } catch {
          hydrated = item;
        }

        return {
          id: hydrated.id,
          title: hydrated.title,
          year: hydrated.year,
          tmdbId: hydrated.tmdbId,
          mediaType: hydrated.mediaType,
          poster: hydrated.poster || '',
          connectorId: hydrated.connectorId,
          connectorType: hydrated.connectorType,
          connectorName: hydrated.connectorName,
          connectorDisplayName: hydrated.connectorDisplayName,
          connectorSourceName: hydrated.connectorSourceName,
          sourceItemId: hydrated.sourceItemId,
          streamPath: hydrated.streamPath,
          season: hydrated.season,
          episode: hydrated.episode,
          overview: hydrated.overview,
          genres: hydrated.genres,
          libraryName: hydrated.libraryName,
          originalLanguage: hydrated.originalLanguage,
          tmdbRating: hydrated.tmdbRating,
          runtimeMinutes: hydrated.runtimeMinutes,
          episodeCount: hydrated.episodeCount,
          seasonCount: hydrated.seasonCount,
          isAnime: hydrated.isAnime,
          scannedAt: hydrated.scannedAt,
          sortKey: hydrated.sortKey,
        } satisfies LibraryItemPayload;
      }),
    );

    return NextResponse.json({
      items,
      connectors,
      pagination: {
        total: filtered.length,
        offset,
        limit: fetchAll ? filtered.length : limit,
        hasMore: fetchAll ? false : offset + items.length < filtered.length,
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
