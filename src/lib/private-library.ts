import type {
  PrivateLibraryConfig,
  PrivateLibraryConnector,
} from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { normalizePrivateLibraryConfig } from './private-library-config';
import { getServerCache, setServerCache } from './server-cache';

export type PrivateLibraryConnectorType = 'openlist' | 'emby' | 'jellyfin';

export interface PrivateLibraryItem {
  id: string;
  connectorId: string;
  connectorType: PrivateLibraryConnectorType;
  sourceItemId: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  streamPath: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
}

export interface PrivateLibraryProgressPayload {
  connectorId: string;
  sourceItemId: string;
  event: 'progress' | 'stopped' | 'played';
  positionTicks: number;
  runtimeTicks?: number;
  paused?: boolean;
}

export interface PrivateLibraryProgressResult {
  ok: boolean;
  synced: boolean;
  detail?: string;
}

export class PrivateLibraryError extends Error {
  code:
    | 'invalid_config'
    | 'unauthorized'
    | 'not_found'
    | 'timeout'
    | 'service_unavailable'
    | 'upstream';
  status?: number;

  constructor(
    message: string,
    code: PrivateLibraryError['code'],
    status?: number,
  ) {
    super(message);
    this.name = 'PrivateLibraryError';
    this.code = code;
    this.status = status;
  }
}

interface OpenListEntry {
  name: string;
  is_dir: boolean;
  path?: string;
  raw_url?: string;
}

interface OpenListListResponse {
  code: number;
  data?: {
    content?: OpenListEntry[];
  };
  message?: string;
}

interface MediaServerAuthenticationResult {
  AccessToken?: string;
  User?: {
    Id?: string;
    Name?: string;
  };
  SessionInfo?: {
    UserId?: string;
  };
}

interface MediaServerAuthSession {
  accessToken: string;
  userId?: string;
  authorizationHeader: string;
}

const PRIVATE_LIBRARY_CACHE_PREFIX = 'private-lib';
const PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS = 12_000;
const PRIVATE_LIBRARY_SCAN_TIMEOUT_MS = 15_000;
const PRIVATE_LIBRARY_AUTH_CACHE_TTL_SECONDS = 6 * 60 * 60;
const PRIVATE_LIBRARY_CLIENT_NAME = 'DecoTV';
const PRIVATE_LIBRARY_CLIENT_DEVICE = 'DecoTV Web';
const PRIVATE_LIBRARY_CLIENT_VERSION = '1.0.0';

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => sanitizeString(item)).filter(Boolean);
}

function createAbortSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function mapUpstreamError(
  serviceName: string,
  error: unknown,
): PrivateLibraryError {
  if (error instanceof PrivateLibraryError) {
    return error;
  }

  if (isAbortError(error)) {
    return new PrivateLibraryError(
      `${serviceName} request timed out.`,
      'timeout',
    );
  }

  if (error instanceof Error) {
    return new PrivateLibraryError(
      `${serviceName} is unavailable.`,
      'service_unavailable',
    );
  }

  return new PrivateLibraryError(`${serviceName} request failed.`, 'upstream');
}

function toFriendlyPrivateLibraryMessage(error: unknown): string {
  if (error instanceof PrivateLibraryError) {
    switch (error.code) {
      case 'invalid_config':
        return error.message;
      case 'unauthorized':
        return 'Authentication failed. Please verify the server address and credentials.';
      case 'not_found':
        return 'Requested media or path was not found on the server.';
      case 'timeout':
        return 'The upstream service timed out. Please try again later.';
      case 'service_unavailable':
        return 'The upstream service is unavailable right now.';
      default:
        return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'The private library request failed.';
}

function buildBasicAuth(username?: string, password?: string): string {
  const u = sanitizeString(username);
  const p = sanitizeString(password);
  if (!u || !p) {
    return '';
  }

  return `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`;
}

function hasCredentialPair(username?: string, password?: string): boolean {
  return Boolean(sanitizeString(username) && sanitizeString(password));
}

function getMediaServerDeviceId(connector: PrivateLibraryConnector): string {
  return `decotv-private-${connector.type}-${connector.id}`;
}

function buildMediaBrowserAuthorizationHeader(args: {
  connector: PrivateLibraryConnector;
  token?: string;
  userId?: string;
}): string {
  const parts = [
    `Client="${PRIVATE_LIBRARY_CLIENT_NAME}"`,
    `Device="${PRIVATE_LIBRARY_CLIENT_DEVICE}"`,
    `DeviceId="${getMediaServerDeviceId(args.connector)}"`,
    `Version="${PRIVATE_LIBRARY_CLIENT_VERSION}"`,
  ];

  if (args.userId) {
    parts.unshift(`UserId="${args.userId}"`);
  }

  if (args.token) {
    parts.push(`Token="${args.token}"`);
  }

  return `MediaBrowser ${parts.join(', ')}`;
}

function getMediaServerAuthCacheKey(
  connector: PrivateLibraryConnector,
): string {
  return `${PRIVATE_LIBRARY_CACHE_PREFIX}:${connector.id}:auth:${connector.updatedAt}`;
}

function openListHeaders(
  connector: PrivateLibraryConnector,
): Record<string, string> {
  const token = sanitizeString(connector.token);
  const basic = buildBasicAuth(connector.username, connector.password);

  return {
    'Content-Type': 'application/json',
    ...(token
      ? {
          Authorization: token.startsWith('Bearer ')
            ? token
            : `Bearer ${token}`,
        }
      : {}),
    ...(basic ? { 'X-Openlist-Basic': basic } : {}),
  };
}

function buildMediaServerHeaders(
  connector: PrivateLibraryConnector,
  auth?: MediaServerAuthSession,
): Record<string, string> {
  const token = sanitizeString(auth?.accessToken || connector.token);
  const userId = sanitizeString(auth?.userId || connector.userId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (token) {
    headers['X-Emby-Token'] = token;
    headers.Authorization = buildMediaBrowserAuthorizationHeader({
      connector,
      token,
      userId: userId || undefined,
    });
    headers['X-Emby-Authorization'] = buildMediaBrowserAuthorizationHeader({
      connector,
      token,
      userId: userId || undefined,
    });
  }

  return headers;
}

async function resolveMediaServerAuth(
  connector: PrivateLibraryConnector,
  options: { forceRefresh?: boolean } = {},
): Promise<MediaServerAuthSession> {
  const staticToken = sanitizeString(connector.token);
  const staticUserId = sanitizeString(connector.userId);
  if (staticToken && !options.forceRefresh) {
    return {
      accessToken: staticToken,
      userId: staticUserId || undefined,
      authorizationHeader: buildMediaBrowserAuthorizationHeader({
        connector,
        token: staticToken,
        userId: staticUserId || undefined,
      }),
    };
  }

  if (!hasCredentialPair(connector.username, connector.password)) {
    throw new PrivateLibraryError(
      'Emby / Jellyfin requires an API key or username/password.',
      'invalid_config',
    );
  }

  const cacheKey = getMediaServerAuthCacheKey(connector);
  if (!options.forceRefresh) {
    const cached = getServerCache<MediaServerAuthSession>(cacheKey);
    if (cached?.accessToken) {
      return cached;
    }
  }

  const authorizationHeader = buildMediaBrowserAuthorizationHeader({
    connector,
  });
  const payload = await fetchJsonWithTimeout<MediaServerAuthenticationResult>(
    `${connector.serverUrl}/Users/AuthenticateByName`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
        'X-Emby-Authorization': authorizationHeader,
      },
      body: JSON.stringify({
        Username: sanitizeString(connector.username),
        Pw: sanitizeString(connector.password),
        Password: sanitizeString(connector.password),
      }),
    },
    PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
    connector.type === 'emby' ? 'Emby' : 'Jellyfin',
  );

  const accessToken = sanitizeString(payload.AccessToken);
  const userId = sanitizeString(
    payload.User?.Id || payload.SessionInfo?.UserId || connector.userId,
  );

  if (!accessToken) {
    throw new PrivateLibraryError(
      `${connector.type === 'emby' ? 'Emby' : 'Jellyfin'} login did not return an access token.`,
      'unauthorized',
    );
  }

  const session: MediaServerAuthSession = {
    accessToken,
    userId: userId || undefined,
    authorizationHeader: buildMediaBrowserAuthorizationHeader({
      connector,
      token: accessToken,
      userId: userId || undefined,
    }),
  };

  setServerCache(cacheKey, session, PRIVATE_LIBRARY_AUTH_CACHE_TTL_SECONDS);
  return session;
}

function parseTmdbId(input: string): number | undefined {
  const match = input.match(/\{tmdb-(\d+)\}/i);
  if (!match) {
    return undefined;
  }

  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function parseTitleYear(input: string): { title: string; year?: number } {
  const cleaned = input.replace(/\{tmdb-\d+\}/gi, '').trim();
  const match = cleaned.match(/^(.*?)(?:\((\d{4})\))?$/);
  if (!match) {
    return { title: cleaned || input };
  }

  const title = match[1].trim() || cleaned || input;
  const year = match[2] ? Number(match[2]) : undefined;
  return {
    title,
    year: Number.isFinite(year || NaN) ? year : undefined,
  };
}

function parseEpisodeInfo(pathOrName: string): {
  season?: number;
  episode?: number;
} {
  const match = pathOrName.match(/S(\d{1,2})E(\d{1,2})/i);
  if (!match) {
    return {};
  }

  return {
    season: Number(match[1]),
    episode: Number(match[2]),
  };
}

function parseTick(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function safeJsonParse<T>(value: unknown): T {
  return value as T;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceName: string,
): Promise<T> {
  const { signal, cleanup } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PrivateLibraryError(
          `${serviceName} authentication failed.`,
          'unauthorized',
          response.status,
        );
      }

      if (response.status === 404) {
        throw new PrivateLibraryError(
          `${serviceName} resource was not found.`,
          'not_found',
          response.status,
        );
      }

      if (response.status >= 500) {
        throw new PrivateLibraryError(
          `${serviceName} is currently unavailable.`,
          'service_unavailable',
          response.status,
        );
      }

      throw new PrivateLibraryError(
        `${serviceName} request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }

    return safeJsonParse<T>(await response.json());
  } catch (error) {
    throw mapUpstreamError(serviceName, error);
  } finally {
    cleanup();
  }
}

async function sendJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceName: string,
): Promise<void> {
  const { signal, cleanup } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PrivateLibraryError(
          `${serviceName} authentication failed.`,
          'unauthorized',
          response.status,
        );
      }

      if (response.status === 404) {
        throw new PrivateLibraryError(
          `${serviceName} resource was not found.`,
          'not_found',
          response.status,
        );
      }

      if (response.status >= 500) {
        throw new PrivateLibraryError(
          `${serviceName} is currently unavailable.`,
          'service_unavailable',
          response.status,
        );
      }

      throw new PrivateLibraryError(
        `${serviceName} request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }
  } catch (error) {
    throw mapUpstreamError(serviceName, error);
  } finally {
    cleanup();
  }
}

async function listOpenListPath(
  connector: PrivateLibraryConnector,
  path: string,
): Promise<OpenListEntry[]> {
  const payload = await fetchJsonWithTimeout<OpenListListResponse>(
    `${connector.serverUrl}/api/fs/list`,
    {
      method: 'POST',
      headers: openListHeaders(connector),
      body: JSON.stringify({
        path,
        refresh: false,
        page: 1,
        per_page: 200,
      }),
    },
    PRIVATE_LIBRARY_SCAN_TIMEOUT_MS,
    'OpenList',
  );

  if (payload.code !== 200) {
    throw new PrivateLibraryError(
      payload.message || 'OpenList request failed.',
      'upstream',
    );
  }

  return payload.data?.content || [];
}

async function scanOpenList(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const rootPath = connector.rootPath || '/Media';
  const level1 = await listOpenListPath(connector, rootPath);
  const items: PrivateLibraryItem[] = [];

  for (const dir of level1) {
    if (!dir.is_dir) {
      continue;
    }

    const dirPath = dir.path || `${rootPath}/${dir.name}`;
    const tmdbId = parseTmdbId(dir.name);
    const { title, year } = parseTitleYear(dir.name);

    let children: OpenListEntry[] = [];
    try {
      children = await listOpenListPath(connector, dirPath);
    } catch {
      continue;
    }

    const mediaFiles = children.filter(
      (entry) =>
        !entry.is_dir && /\.(mkv|mp4|m3u8|mov|avi|flv|ts)$/i.test(entry.name),
    );

    for (const media of mediaFiles) {
      const mediaPath = media.path || `${dirPath}/${media.name}`;
      const { season, episode } = parseEpisodeInfo(`${dirPath}/${media.name}`);
      const mediaType: 'movie' | 'tv' = season || episode ? 'tv' : 'movie';
      const sourceItemId = `${dirPath}::${mediaPath}`;

      items.push({
        id: `${connector.id}:${Buffer.from(sourceItemId).toString('base64url')}`,
        connectorId: connector.id,
        connectorType: connector.type,
        sourceItemId,
        title,
        year,
        tmdbId,
        mediaType,
        streamPath: mediaPath,
        season,
        episode,
      });
    }
  }

  return items;
}

async function scanEmbyLike(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const auth = await resolveMediaServerAuth(connector);
  const libraryFilter = new Set(
    sanitizeStringArray(connector.libraryFilter).map((item) =>
      item.toLowerCase(),
    ),
  );
  const authQuery = auth.accessToken
    ? `api_key=${encodeURIComponent(auth.accessToken)}`
    : '';
  const payload = await fetchJsonWithTimeout<{
    Items?: Array<{
      Id: string;
      Name: string;
      Type: string;
      ProductionYear?: number;
      CollectionType?: string;
      SeriesName?: string;
      ProviderIds?: { Tmdb?: string };
      Overview?: string;
      Genres?: string[];
    }>;
  }>(
    `${connector.serverUrl}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,ProductionYear,CollectionType,Overview,Genres&${authQuery}`,
    {
      headers: buildMediaServerHeaders(connector, auth),
    },
    PRIVATE_LIBRARY_SCAN_TIMEOUT_MS,
    connector.type === 'emby' ? 'Emby' : 'Jellyfin',
  );

  const items: PrivateLibraryItem[] = [];
  for (const item of payload.Items || []) {
    if (!item?.Id || !item?.Name) {
      continue;
    }

    if (
      libraryFilter.size > 0 &&
      !libraryFilter.has(item.CollectionType?.toLowerCase() || '')
    ) {
      continue;
    }

    const mediaType: 'movie' | 'tv' = item.Type === 'Series' ? 'tv' : 'movie';
    const tmdbIdRaw = item.ProviderIds?.Tmdb;
    const tmdbId = tmdbIdRaw ? Number(tmdbIdRaw) : undefined;

    items.push({
      id: `${connector.id}:${item.Id}`,
      connectorId: connector.id,
      connectorType: connector.type,
      sourceItemId: item.Id,
      title: item.Name,
      year: item.ProductionYear,
      tmdbId: Number.isFinite(tmdbId || NaN) ? tmdbId : undefined,
      mediaType,
      streamPath: item.Id,
      overview: sanitizeString(item.Overview),
      genres: sanitizeStringArray(item.Genres),
      libraryName: sanitizeString(item.CollectionType),
    });
  }

  return items;
}

function getConnectorCacheKey(connectorId: string): string {
  return `${PRIVATE_LIBRARY_CACHE_PREFIX}:${connectorId}:items`;
}

export function getPrivateLibraryConnectorTypeLabel(
  type: PrivateLibraryConnectorType,
): string {
  switch (type) {
    case 'emby':
      return 'Emby';
    case 'jellyfin':
      return 'Jellyfin';
    default:
      return 'OpenList';
  }
}

export function formatPrivateLibrarySourceName(
  connector: Pick<PrivateLibraryConnector, 'type' | 'name'>,
): string {
  return `${getPrivateLibraryConnectorTypeLabel(connector.type)} · ${connector.name}`;
}

export function buildPrivateLibraryPosterUrl(
  connectorId: string,
  sourceItemId: string,
): string {
  return `/api/private-library/poster?connectorId=${encodeURIComponent(connectorId)}&sourceItemId=${encodeURIComponent(sourceItemId)}`;
}

function buildPrivateProgressKey(
  username: string,
  connectorType: PrivateLibraryConnectorType,
  sourceItemId: string,
): string {
  return `private:progress:${username}:${connectorType}:${sourceItemId}`;
}

function buildPrivateLibraryItemId(
  connector: Pick<PrivateLibraryConnector, 'id' | 'type'>,
  sourceItemId: string,
): string {
  if (connector.type === 'openlist') {
    return `${connector.id}:${Buffer.from(sourceItemId).toString('base64url')}`;
  }

  return `${connector.id}:${sourceItemId}`;
}

export async function scanConnector(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const items =
    connector.type === 'openlist'
      ? await scanOpenList(connector)
      : await scanEmbyLike(connector);

  setServerCache(getConnectorCacheKey(connector.id), items, 3600);
  return items;
}

export function getConnectorCachedItems(
  connectorId: string,
): PrivateLibraryItem[] {
  return (
    getServerCache<PrivateLibraryItem[]>(getConnectorCacheKey(connectorId)) ||
    []
  );
}

export async function getPrivateLibraryConfig(): Promise<PrivateLibraryConfig> {
  const config = await getConfig();
  return normalizePrivateLibraryConfig(config.PrivateLibraryConfig);
}

export async function hasEnabledPrivateLibraryConnector(): Promise<boolean> {
  const cfg = await getPrivateLibraryConfig();
  return cfg.connectors.some((item) => item.enabled);
}

export async function testConnector(
  connector: PrivateLibraryConnector,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    if (!sanitizeString(connector.serverUrl)) {
      throw new PrivateLibraryError(
        'Server URL is required.',
        'invalid_config',
      );
    }

    if (connector.type === 'openlist') {
      await listOpenListPath(connector, connector.rootPath || '/Media');
      return { ok: true };
    }

    const auth = await resolveMediaServerAuth(connector);
    const authQuery = auth.accessToken
      ? `api_key=${encodeURIComponent(auth.accessToken)}`
      : '';

    await fetchJsonWithTimeout<{ Items?: unknown[] }>(
      `${connector.serverUrl}/Items?Limit=1&Recursive=false&${authQuery}`,
      {
        headers: buildMediaServerHeaders(connector, auth),
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      connector.type === 'emby' ? 'Emby' : 'Jellyfin',
    );

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: toFriendlyPrivateLibraryMessage(error),
    };
  }
}

export async function resolveStreamRequest(
  connectorId: string,
  sourceItemId: string,
): Promise<{ url: string; headers?: Record<string, string> } | null> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === connectorId && item.enabled,
  );
  if (!connector) {
    return null;
  }

  if (connector.type === 'openlist') {
    const targetPath = sourceItemId.split('::')[1] || sourceItemId;
    const encodedPath = targetPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return {
      url: `${connector.serverUrl}/d${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`,
      headers: openListHeaders(connector),
    };
  }

  const auth = await resolveMediaServerAuth(connector);
  const query = new URLSearchParams();
  query.set('static', 'true');
  if (auth.accessToken) {
    query.set('api_key', auth.accessToken);
  }

  return {
    url: `${connector.serverUrl}/Videos/${encodeURIComponent(sourceItemId)}/stream?${query.toString()}`,
    headers: buildMediaServerHeaders(connector, auth),
  };
}

export async function resolvePosterRequest(
  connectorId: string,
  sourceItemId: string,
): Promise<{ url: string; headers?: Record<string, string> } | null> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === connectorId && item.enabled,
  );
  if (!connector || connector.type === 'openlist') {
    return null;
  }

  const auth = await resolveMediaServerAuth(connector);
  const query = new URLSearchParams();
  query.set('quality', '90');
  query.set('maxWidth', '500');
  if (auth.accessToken) {
    query.set('api_key', auth.accessToken);
  }

  return {
    url: `${connector.serverUrl}/Items/${encodeURIComponent(sourceItemId)}/Images/Primary?${query.toString()}`,
    headers: buildMediaServerHeaders(connector, auth),
  };
}

export async function reportPrivateLibraryProgress(
  username: string,
  payload: PrivateLibraryProgressPayload,
): Promise<PrivateLibraryProgressResult> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === payload.connectorId && item.enabled,
  );

  if (!connector) {
    return {
      ok: false,
      synced: false,
      detail: 'Private library connector was not found.',
    };
  }

  try {
    const legacyProgressKey = buildPrivateProgressKey(
      username,
      connector.type,
      payload.sourceItemId,
    );
    await db.deletePlayRecordByKey(username, legacyProgressKey);
    await db.deletePlayRecord(
      username,
      `private-progress:${connector.id}`,
      buildPrivateLibraryItemId(connector, payload.sourceItemId),
    );
  } catch {
    // Ignore legacy cleanup failures. Public play history is now saved from the player page.
  }

  if (connector.type === 'openlist') {
    return { ok: true, synced: false };
  }

  const auth = await resolveMediaServerAuth(connector);
  const headers = buildMediaServerHeaders(connector, auth);
  const positionTicks = parseTick(payload.positionTicks);
  const runtimeTicks = parseTick(payload.runtimeTicks);
  const baseUrl = connector.serverUrl.replace(/\/+$/, '');
  const authQuery = auth.accessToken
    ? `?api_key=${encodeURIComponent(auth.accessToken)}`
    : '';
  const effectiveUserId = sanitizeString(connector.userId || auth.userId);
  const body = {
    ItemId: payload.sourceItemId,
    PositionTicks: positionTicks,
    CanSeek: true,
    IsPaused: Boolean(payload.paused),
    PlaybackStartTimeTicks: Date.now() * 10000,
    ...(runtimeTicks > 0 ? { RunTimeTicks: runtimeTicks } : {}),
  };

  const send = async (path: string, initBody?: object) => {
    await sendJsonWithTimeout(
      `${baseUrl}${path}${authQuery}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(initBody || body),
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      connector.type === 'emby' ? 'Emby' : 'Jellyfin',
    );
  };

  try {
    if (payload.event === 'played') {
      if (effectiveUserId) {
        await send(
          `/Users/${encodeURIComponent(effectiveUserId)}/PlayedItems/${encodeURIComponent(payload.sourceItemId)}`,
          {},
        );
      }
      await send('/Sessions/Playing/Stopped');
      return { ok: true, synced: true };
    }

    if (payload.event === 'stopped') {
      await send('/Sessions/Playing/Stopped');
      return { ok: true, synced: true };
    }

    await send('/Sessions/Playing/Progress');
    return { ok: true, synced: true };
  } catch (error) {
    return {
      ok: true,
      synced: false,
      detail: toFriendlyPrivateLibraryMessage(error),
    };
  }
}

export function toPrivateLibraryErrorMessage(error: unknown): string {
  return toFriendlyPrivateLibraryMessage(error);
}
