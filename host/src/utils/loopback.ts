const IPV4_MAPPED_IPV6_PREFIX = /^::ffff:/i;
const EXPANDED_IPV6_LOOPBACK = '0:0:0:0:0:0:0:1';
const SHORT_IPV6_LOOPBACK = '::1';

export function normalizeAddress(ip: string): string {
  return ip.trim().replace(IPV4_MAPPED_IPV6_PREFIX, '');
}

export function isLoopbackAddress(ip: string): boolean {
  const normalized = normalizeAddress(ip).toLowerCase();

  if (normalized === SHORT_IPV6_LOOPBACK || normalized === EXPANDED_IPV6_LOOPBACK) {
    return true;
  }

  const octets = normalized.split('.');
  if (octets.length !== 4) {
    return false;
  }

  const numericOctets = octets.map((segment) => Number(segment));
  if (numericOctets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  return numericOctets[0] === 127;
}
