import { describe, expect, it } from 'vitest';
import { SPARK_HOSTS, unreachableSparkHosts } from '../src/lib/reachability';

describe('Spark reachability', () => {
  it('lists the hosts a probe could not reach', async () => {
    expect(await unreachableSparkHosts(async () => true)).toEqual([]);
    const blocked = await unreachableSparkHosts(async (u) => !u.includes('flashnet'));
    expect(blocked).toEqual(['https://2.spark.flashnet.xyz']);
    expect(SPARK_HOSTS.length).toBeGreaterThan(0);
  });
});
