const HLS_EXTENSION_PATTERN = /\.m3u8(?:$|[?#])/i;
const HLS_ENDPOINT_PATTERN = /\/m3u8(?:$|[/?#])/i;
const HLS_PROXY_PATH_PATTERN = /\/api\/proxy\/m3u8(?:-filter)?\/?$/i;
const MAX_PROXY_UNWRAP_DEPTH = 3;

export function isLikelyHlsUrl(url: string, depth = 0): boolean {
  if (!url) {
    return false;
  }

  if (HLS_EXTENSION_PATTERN.test(url) || HLS_ENDPOINT_PATTERN.test(url)) {
    return true;
  }

  if (depth >= MAX_PROXY_UNWRAP_DEPTH) {
    return false;
  }

  try {
    const parsed = new URL(url, 'http://localhost');
    if (!HLS_PROXY_PATH_PATTERN.test(parsed.pathname)) {
      return false;
    }

    const upstreamUrl = parsed.searchParams.get('url');
    return upstreamUrl ? isLikelyHlsUrl(upstreamUrl, depth + 1) : false;
  } catch {
    return false;
  }
}
