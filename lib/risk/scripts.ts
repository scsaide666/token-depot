// Redis TIME is authoritative. Decisions across user/key/IP/endpoint and the
// per-key expiring lease are atomic; no read-then-write process-local counters.
export const admitScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local id, budget, window, lease, count = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local concurrency = tonumber(ARGV[6])
local marker, slots = KEYS[count * 4 + 2], KEYS[count * 4 + 1]
if redis.call('GET', marker) then return {1, 0, 0, 0} end
for i = 1, count do
  local rpm, tpm = tonumber(ARGV[5 + i * 2]), tonumber(ARGV[6 + i * 2])
  local r, z, h, s = KEYS[i * 4 - 3], KEYS[i * 4 - 2], KEYS[i * 4 - 1], KEYS[i * 4]
  redis.call('ZREMRANGEBYSCORE', r, '-inf', now - window)
  local sum = tonumber(redis.call('GET', s) or '0')
  local expired = redis.call('ZRANGEBYSCORE', z, '-inf', now)
  for _, member in ipairs(expired) do sum = sum - tonumber(redis.call('HGET', h, member) or '0'); redis.call('HDEL', h, member) end
  redis.call('ZREMRANGEBYSCORE', z, '-inf', now)
  sum = math.max(0, sum)
  if redis.call('EXISTS', s) == 1 then redis.call('SET', s, sum, 'PX', lease + window) end
  if rpm > 0 and redis.call('ZCARD', r) >= rpm then
    local oldest = redis.call('ZRANGE', r, 0, 0, 'WITHSCORES')
    return {0, i, 1, math.max(1, tonumber(oldest[2]) + window - now)}
  end
  if tpm > 0 and sum + budget > tpm then
    local oldest = redis.call('ZRANGE', z, 0, 0, 'WITHSCORES')
    return {0, i, 2, math.max(1, oldest[2] and tonumber(oldest[2]) - now or window)}
  end
end
if concurrency > 0 then
  redis.call('ZREMRANGEBYSCORE', slots, '-inf', now)
  if redis.call('ZCARD', slots) >= concurrency then return {0, count + 1, 3, 1000} end
end
for i = 1, count do
  local rpm, tpm = tonumber(ARGV[5 + i * 2]), tonumber(ARGV[6 + i * 2])
  local r, z, h, s = KEYS[i * 4 - 3], KEYS[i * 4 - 2], KEYS[i * 4 - 1], KEYS[i * 4]
  if rpm > 0 then redis.call('ZADD', r, now, id); redis.call('PEXPIRE', r, window + 1000) end
  if tpm > 0 and budget > 0 then
    redis.call('ZADD', z, now + lease, id); redis.call('HSET', h, id, budget)
    redis.call('INCRBY', s, budget)
    redis.call('PEXPIRE', z, lease + window); redis.call('PEXPIRE', h, lease + window); redis.call('PEXPIRE', s, lease + window)
  end
end
if concurrency > 0 then redis.call('ZADD', slots, now + lease, id); redis.call('PEXPIRE', slots, lease + 1000) end
redis.call('SET', marker, 'open', 'PX', lease + window)
return {1, 0, 0, 0}
`;

export const finishScript = `
local id, actual, window, count = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local marker, slots = KEYS[count * 4 + 2], KEYS[count * 4 + 1]
if redis.call('GET', marker) ~= 'open' then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
for i = 1, count do
  local z, h, s = KEYS[i * 4 - 2], KEYS[i * 4 - 1], KEYS[i * 4]
  local old = redis.call('HGET', h, id)
  if old then
    local sum = math.max(0, tonumber(redis.call('GET', s) or '0') - tonumber(old) + actual)
    redis.call('SET', s, sum, 'KEEPTTL')
    if actual == 0 then redis.call('ZREM', z, id); redis.call('HDEL', h, id)
    else
      redis.call('HSET', h, id, actual); redis.call('ZADD', z, now + window, id)
      for _, key in ipairs({z, h, s}) do
        if redis.call('PTTL', key) < window + 1000 then redis.call('PEXPIRE', key, window + 1000) end
      end
    end
  end
end
redis.call('ZREM', slots, id)
redis.call('SET', marker, 'done', 'PX', window * 2)
return 1
`;

export const behaviorScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;
