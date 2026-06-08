export type TvboxEncodedIdPayload =
  | {
      kind: 'douban';
      id: string;
      title: string;
      poster?: string;
      year?: string;
      rate?: string;
      typeName?: string;
    }
  | {
      kind: 'source';
      id: string;
      title: string;
      source: string;
      sourceName?: string;
    };

export function getLastNonEmptySearchParam(
  searchParams: URLSearchParams,
  names: string[],
): string {
  for (const name of names) {
    const values = searchParams.getAll(name);
    for (let i = values.length - 1; i >= 0; i--) {
      const value = values[i]?.trim();
      if (value) return value;
    }
  }
  return '';
}

export function encodeTvboxId(payload: TvboxEncodedIdPayload): string {
  return `dtv_${Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )}`;
}

export function decodeTvboxId(value: string): TvboxEncodedIdPayload | null {
  if (!value.startsWith('dtv_')) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(4), 'base64url').toString('utf8'),
    ) as TvboxEncodedIdPayload;

    if (decoded.kind === 'douban' && decoded.id && decoded.title) {
      return decoded;
    }

    if (
      decoded.kind === 'source' &&
      decoded.id &&
      decoded.title &&
      decoded.source
    ) {
      return decoded;
    }
  } catch {
    return null;
  }

  return null;
}
