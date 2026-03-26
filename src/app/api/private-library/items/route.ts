import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  formatPrivateLibrarySourceName,
  getConnectorCachedItems,
  getPrivateLibraryConfig,
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
    const cfg = await getPrivateLibraryConfig();
    const enabled = cfg.connectors.filter(
      (item) =>
        item.enabled && (!connectorIdFilter || item.id === connectorIdFilter),
    );
    const merged: LibraryItemPayload[] = [];
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
        if (
          mediaTypeFilter &&
          mediaTypeFilter !== 'all' &&
          item.mediaType !== mediaTypeFilter
        ) {
          continue;
        }

        let title = item.title;
        let poster = '';
        let overview = '';

        if (item.tmdbId) {
          try {
            if (item.mediaType === 'movie') {
              const detail = await tmdbGetMovieDetail(item.tmdbId);
              title = detail.title || title;
              poster = toTmdbPosterUrl(detail.poster_path);
              overview = detail.overview || '';
            } else {
              const detail = await tmdbGetTvDetail(item.tmdbId);
              title = detail.name || title;
              poster = toTmdbPosterUrl(detail.poster_path);
              overview = detail.overview || '';
            }
          } catch {
            // TMDB 补充元数据失败时保留原始条目。
          }
        }

        merged.push({
          id: item.id,
          title,
          year: item.year,
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          poster,
          connectorId: connector.id,
          connectorType: connector.type,
          connectorName: connector.name,
          connectorSourceName: formatPrivateLibrarySourceName(connector),
          streamPath: item.streamPath,
          sourceItemId: item.sourceItemId,
          season: item.season,
          episode: item.episode,
          overview,
        });
      }
    }

    return NextResponse.json({
      items: merged,
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
