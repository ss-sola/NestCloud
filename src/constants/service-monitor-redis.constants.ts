export const RENEW_MONITOR_LEASE = `
  local owner = redis.call('GET', KEYS[1])
  if owner and owner ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
`;

export const SAVE_MONITOR_SNAPSHOT = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
  return 1
`;
