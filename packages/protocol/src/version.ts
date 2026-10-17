/**
 * protocolVersion is MAJOR.MINOR only — a wire contract, not a package version
 * (docs/adr/0002-universal-bot-protocol.md).
 */
export const CURRENT_PROTOCOL_VERSION = '1.0';

/** Major versions this build of the protocol package can validate/decode. */
const SUPPORTED_MAJOR_VERSIONS: readonly number[] = [1];

export interface ParsedProtocolVersion {
  major: number;
  minor: number;
}

export function parseProtocolVersion(version: string): ParsedProtocolVersion | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * MINOR bumps are additive-only, so a supported major version is sufficient regardless of
 * minor — an older engine build must keep working against a newer-MINOR bot, and vice versa.
 */
export function isSupportedProtocolVersion(version: string): boolean {
  const parsed = parseProtocolVersion(version);
  return parsed !== undefined && SUPPORTED_MAJOR_VERSIONS.includes(parsed.major);
}
