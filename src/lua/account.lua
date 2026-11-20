local p, data = ARGV[1], cjson.decode(ARGV[2])
local function typed(k,t) local v=redis.call('TYPE',k).ok; if v~='none' and v~=t then error('Invalid Redis type: '..k) end end
typed(p..'contador:usuarios','string')
typed(p..'indice:usuario:'..data.usuario,'string')
typed(p..'indice:telefono:'..data.telefono,'string')
if redis.call('EXISTS',p..'indice:usuario:'..data.usuario)==1 then return {'error','USUARIO_DUPLICADO'} end
if redis.call('EXISTS',p..'indice:telefono:'..data.telefono)==1 then return {'error','TELEFONO_DUPLICADO'} end
local nextid=tostring(tonumber(redis.call('GET',p..'contador:usuarios') or '0')+1)
typed(p..'usuario:'..nextid,'hash')
local id=tostring(redis.call('INCR',p..'contador:usuarios'))
data.id=id
for k,v in pairs(data) do redis.call('HSET',p..'usuario:'..id,k,tostring(v)) end
redis.call('SET',p..'indice:usuario:'..data.usuario,id)
redis.call('SET',p..'indice:telefono:'..data.telefono,id)
return {'ok',id}
