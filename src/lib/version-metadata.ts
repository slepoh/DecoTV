export const VERSION_TIMESTAMP_REGEX = /^\d{14}$/;

export interface BuildMetadata {
  version: string;
  timestamp: string;
  buildTime?: string;
  commitSha?: string;
  shortCommit?: string;
  commitDate?: string;
  ref?: string;
  repo?: string;
  source?: string;
}

export type UpdateReason = 'semantic-version' | 'commit' | 'timestamp' | 'none';

export interface VersionComparison {
  hasUpdate: boolean;
  reason: UpdateReason;
}

export function normalizeVersion(version?: string | null): string {
  return (version || '').trim().replace(/^v/i, '');
}

export function normalizeCommitSha(sha?: string | null): string {
  const normalized = (sha || '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : '';
}

export function shortCommit(sha?: string | null): string {
  const normalized = normalizeCommitSha(sha);
  return normalized ? normalized.slice(0, 7) : '';
}

export function isValidTimestamp(timestamp?: string | null): boolean {
  return VERSION_TIMESTAMP_REGEX.test((timestamp || '').trim());
}

export function compareTimestamps(
  local?: string | null,
  remote?: string | null,
) {
  if (!isValidTimestamp(local) || !isValidTimestamp(remote)) return 0;

  const localNum = BigInt(local as string);
  const remoteNum = BigInt(remote as string);

  if (localNum > remoteNum) return 1;
  if (localNum < remoteNum) return -1;
  return 0;
}

export function compareSemanticVersions(
  localVersion?: string | null,
  remoteVersion?: string | null,
): number {
  const local = normalizeVersion(localVersion);
  const remote = normalizeVersion(remoteVersion);

  if (!local || !remote) return 0;

  const localParts = local.split(/[.-]/).map((part) => Number(part) || 0);
  const remoteParts = remote.split(/[.-]/).map((part) => Number(part) || 0);
  const length = Math.max(localParts.length, remoteParts.length);

  for (let index = 0; index < length; index += 1) {
    const localPart = localParts[index] || 0;
    const remotePart = remoteParts[index] || 0;

    if (localPart > remotePart) return 1;
    if (localPart < remotePart) return -1;
  }

  return 0;
}

export function compareIsoDates(local?: string | null, remote?: string | null) {
  const localTime = local ? Date.parse(local) : NaN;
  const remoteTime = remote ? Date.parse(remote) : NaN;

  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime)) return 0;
  if (localTime > remoteTime) return 1;
  if (localTime < remoteTime) return -1;
  return 0;
}

export function timestampToDisplay(timestamp?: string | null): string {
  const value = (timestamp || '').trim();
  if (!isValidTimestamp(value)) return value;

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

export function isoToDisplay(iso?: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function timestampFromIso(iso?: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function compareBuildMetadata(
  local: BuildMetadata,
  remote: BuildMetadata,
): VersionComparison {
  const semanticComparison = compareSemanticVersions(
    local.version,
    remote.version,
  );

  if (semanticComparison < 0) {
    return { hasUpdate: true, reason: 'semantic-version' };
  }

  const localSha = normalizeCommitSha(local.commitSha);
  const remoteSha = normalizeCommitSha(remote.commitSha);

  if (localSha && remoteSha) {
    if (localSha === remoteSha) {
      return { hasUpdate: false, reason: 'none' };
    }

    const commitDateComparison = compareIsoDates(
      local.commitDate,
      remote.commitDate,
    );

    if (commitDateComparison < 0) {
      return { hasUpdate: true, reason: 'commit' };
    }

    if (commitDateComparison > 0) {
      return { hasUpdate: false, reason: 'none' };
    }

    return { hasUpdate: true, reason: 'commit' };
  }

  const timestampComparison = compareTimestamps(
    local.timestamp,
    remote.timestamp,
  );
  if (timestampComparison < 0) {
    return { hasUpdate: true, reason: 'timestamp' };
  }

  return { hasUpdate: false, reason: 'none' };
}
