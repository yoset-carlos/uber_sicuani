local p,uid,value=ARGV[1],ARGV[2],ARGV[3]
local key=p..'usuario:'..uid
local typ=redis.call('TYPE',p..'conductores:disponibles').ok
if typ~='none' and typ~='set' then error('Invalid availability index type') end
if redis.call('HGET',key,'rol')~='conductor' or redis.call('HGET',key,'aprobado')~='1' then return 0 end
redis.call('HSET',key,'disponible',value)
if value=='1' then redis.call('SADD',p..'conductores:disponibles',uid) else redis.call('SREM',p..'conductores:disponibles',uid) end
return 1
