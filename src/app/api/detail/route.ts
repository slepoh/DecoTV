import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import {
  buildPrivateLibraryPosterUrl,
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
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authInfo?.username || (authResult.isLocalMode ? '__local__' : '');

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();
  const sourceCode = (searchParams.get('source') || '').trim();

  if (!id || !sourceCode) {
    return NextResponse.json(
      { error: 'id 和 source 不能为空' },
      { status: 400 },
    );
  }

  if (sourceCode !== 'private_library' && !/^[\w-]+$/.test(id)) {
    return NextResponse.json(
      { error: '资源站详情 id 格式无效' },
      { status: 400 },
    );
  }

  try {
    if (sourceCode === 'private_library') {
      const cfg = await getPrivateLibraryConfig();
      const enabledConnectors = cfg.connectors.filter((item) => item.enabled);
      const scanErrors: string[] = [];

      for (const connector of enabledConnectors) {
        let items = getConnectorCachedItems(connector.id);
        if (items.length === 0) {
          try {
            items = await scanConnector(connector);
          } catch (error) {
            scanErrors.push(
              `${connector.name}: ${toPrivateLibraryErrorMessage(error)}`,
            );
            continue;
          }
        }

        const target = items.find((item) => item.id === id);
        if (!target) {
          continue;
        }

        let title = target.title;
        let poster =
          connector.type === 'openlist'
            ? ''
            : buildPrivateLibraryPosterUrl(
                target.connectorId,
                target.sourceItemId,
              );
        let desc = target.overview || '';

        if (target.tmdbId) {
          try {
            if (target.mediaType === 'movie') {
              const detail = await tmdbGetMovieDetail(target.tmdbId);
              title = detail.title || title;
              poster = toTmdbPosterUrl(detail.poster_path);
              desc = detail.overview || '';
            } else {
              const detail = await tmdbGetTvDetail(target.tmdbId);
              title = detail.name || title;
              poster = toTmdbPosterUrl(detail.poster_path);
              desc = detail.overview || '';
            }
          } catch {
            // TMDB 失败时保留基础文件信息。
          }
        }

        const streamUrl = `/api/private-library/stream?connectorId=${encodeURIComponent(target.connectorId)}&sourceItemId=${encodeURIComponent(target.sourceItemId)}`;

        const result: SearchResult = {
          id: target.id,
          title,
          poster,
          episodes: [streamUrl],
          episodes_titles: [target.title],
          source: 'private_library',
          source_name: formatPrivateLibrarySourceName(connector),
          class: '私人影库',
          year: target.year ? String(target.year) : 'unknown',
          desc,
          type_name: target.mediaType === 'tv' ? '剧集' : '电影',
          douban_id: undefined,
          tmdb_id: target.tmdbId,
          connector_id: target.connectorId,
          source_item_id: target.sourceItemId,
        };

        return NextResponse.json(result, {
          headers: {
            'Cache-Control': 'private, max-age=30',
          },
        });
      }

      if (
        scanErrors.length === enabledConnectors.length &&
        scanErrors.length > 0
      ) {
        return NextResponse.json(
          {
            error: '私人影库当前不可用',
            details: scanErrors[0],
          },
          { status: 502 },
        );
      }

      return NextResponse.json(
        { error: '未找到对应的私人影库资源' },
        { status: 404 },
      );
    }

    const apiSites = await getAvailableApiSites(username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json(
        { error: '未找到对应的资源站配置' },
        { status: 400 },
      );
    }

    const result = await getDetailFromApi(apiSite, id);
    const cacheTime = await getCacheTime();

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '读取详情失败',
        details: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}
