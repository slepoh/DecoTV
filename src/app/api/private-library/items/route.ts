import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  formatPrivateLibrarySourceName,
  getConnectorCachedItems,
  getPrivateLibraryConfig,
  getPrivateLibraryConnectorTypeLabel,
  type PrivateLibraryConnectorType,
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
  type: PrivateLibraryConnectorType;
  typeLabel: string;
}

interface ErrorPayload {
  connectorId: string;
  connectorName: string;
  error: string;
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

function sortItems(items: LibraryItemPayload[]): LibraryItemPayload[] {
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
    const offset = parsePositiveInt(searchParams.get('offset'), 0, 20_000);
    const limit = parsePositiveInt(searchParams.get('limit'), 60, 5_000);

    const cfg = await getPrivateLibraryConfig();
    const enabled = cfg.connectors.filter(
      (item) =>
        item.enabled && (!connectorIdFilter || item.id === connectorIdFilter),
    );

    const merged: LibraryItemPayload[] = [];
    const connectors: ConnectorPayload[] = [];
    const errors: ErrorPayload[] = [];

    for (const connector of enabled) {
      connectors.push({
        id: connector.id,
        name: connector.name,
        displayName: connector.displayName,
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
          id: item.id,
          title: item.title,
          year: item.year,
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          poster: item.poster || '',
          connectorId: item.connectorId,
          connectorType: item.connectorType,
          connectorName: connector.name,
          connectorDisplayName: connector.displayName,
          connectorSourceName: formatPrivateLibrarySourceName(connector),
          sourceItemId: item.sourceItemId,
          streamPath: item.streamPath,
          season: item.season,
          episode: item.episode,
          overview: item.overview,
          genres: item.genres,
          libraryName: item.libraryName,
          originalLanguage: item.originalLanguage,
          tmdbRating: item.tmdbRating,
          runtimeMinutes: item.runtimeMinutes,
          episodeCount: item.episodeCount,
          seasonCount: item.seasonCount,
          isAnime: item.isAnime,
          scannedAt: item.scannedAt,
          sortKey: item.sortKey,
        });
      }
    }

    const sorted = sortItems(merged);
    const items = fetchAll ? sorted : sorted.slice(offset, offset + limit);

    return NextResponse.json({
      items,
      connectors,
      pagination: {
        total: sorted.length,
        offset,
        limit: fetchAll ? sorted.length : limit,
        hasMore: fetchAll ? false : offset + items.length < sorted.length,
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
