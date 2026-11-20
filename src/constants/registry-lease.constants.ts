/** 比对并写入同一实例哈希。空快照表示仅在实例不存在时写入。 */
export const WRITE_REGISTRY_LEASE = `
  local current = redis.call('HGET', KEYS[1], ARGV[1])
  if (current or '') ~= ARGV[2] then return 0 end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
  return 1
`;

/** 只有租约仍与扫描到的记录相同，才能删除它。 */
export const EXPIRE_REGISTRY_LEASE = `
  if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
  return redis.call('HDEL', KEYS[1], ARGV[1])
`;
