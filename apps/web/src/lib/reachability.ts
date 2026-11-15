/**
 * Can this network reach the Spark operators? Some networks (e.g. a campus DNS) fail to resolve
 * an operator host; the wallet then can't sync or pay. We probe once at startup and show a clear
 * banner instead of a generic error later.
 *
 * Hosts: the operator and service URLs in `defaultConfig('regtest' | 'mainnet')` of
 * @breeztech/breez-sdk-spark 0.28.4 (printed from the SDK, not guessed). Update with the SDK.
 */
export const SPARK_HOSTS = [
  'https://0.spark.lightspark.com',
  'https://2.spark.flashnet.xyz',
  'https://spark-operator.breez.technology',
] as const;

export type Probe = (url: string) => Promise<boolean>;

/** `no-cors` fetch: resolves (opaque) when the host is reachable, rejects on DNS/network failure. */
export const fetchProbe: Probe = async (url) => {
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return true;
  } catch {
    return false;
  }
};

/** The hosts that could not be reached (empty = all good). */
export async function unreachableSparkHosts(probe: Probe = fetchProbe): Promise<string[]> {
  const results = await Promise.all(SPARK_HOSTS.map(async (h) => [h, await probe(h)] as const));
  return results.filter(([, ok]) => !ok).map(([h]) => h);
}
