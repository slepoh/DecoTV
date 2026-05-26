import { createHash } from 'crypto';

export const DANDANPLAY_API_BASE = 'https://api.dandanplay.net';

export interface DandanplayCredentials {
  appId: string;
  appSecret: string;
}

export function getDandanplayCredentials(): DandanplayCredentials {
  return {
    appId: (process.env.DANDANPLAY_APP_ID || '').trim(),
    appSecret: (process.env.DANDANPLAY_APP_SECRET || '').trim(),
  };
}

/**
 * Signs a dandanplay API path without placing the AppSecret in the request.
 * The secret must only be read by server-side route handlers.
 */
export function generateDandanplaySignature(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: number,
): string {
  return createHash('sha256')
    .update(appId + timestamp + path + appSecret)
    .digest('base64');
}

export function buildDandanplayHeaders(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'DecoTV/1.4',
  };

  if (!appId || !appSecret) return headers;

  headers['X-AppId'] = appId;
  headers['X-Timestamp'] = String(timestamp);
  headers['X-Signature'] = generateDandanplaySignature(
    appId,
    appSecret,
    path,
    timestamp,
  );
  return headers;
}

export function buildDandanplayEpisodeSearchUrl(options: {
  anime?: string;
  tmdbId?: number;
  episode?: number;
}): string {
  const params = new URLSearchParams();
  const anime = options.anime?.trim();

  if (anime) params.set('anime', anime);
  if (options.tmdbId && options.tmdbId > 0) {
    params.set('tmdbId', String(options.tmdbId));
  }
  if (options.episode && options.episode > 0) {
    params.set('episode', String(options.episode));
  }

  return `${DANDANPLAY_API_BASE}/api/v2/search/episodes?${params.toString()}`;
}
