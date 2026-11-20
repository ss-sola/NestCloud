/** 只比较并更新实例哈希，兼容 Redis Cluster 中分属不同槽的原有键。 */
export const RENEW_REGISTRY_LEASE = `
  if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
  return 1
`;

/** 只有租约仍与扫描到的记录相同，才能删除它。 */
export const EXPIRE_REGISTRY_LEASE = `
  if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
  return redis.call('HDEL', KEYS[1], ARGV[1])
`;
