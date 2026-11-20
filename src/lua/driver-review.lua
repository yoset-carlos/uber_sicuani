local p, id, action, reason, actor, at = unpack(ARGV)
local key = p..'usuario:'..id
if redis.call('HGET',key,'rol') ~= 'conductor' then return 'NOT_FOUND' end
if redis.call('HGET',key,'aprobado') == '1' then return 'CONFLICT' end
if action == 'rechazar' and redis.call('HGET',key,'revision_estado') == 'rechazado' then return 'CONFLICT' end
local logtype = redis.call('TYPE',p..'conductores:revisiones').ok
if logtype ~= 'none' and logtype ~= 'stream' then return redis.error_reply('Invalid review log type') end
redis.call('HSET',key,'aprobado',action == 'aprobar' and '1' or '0','revision_estado',action == 'aprobar' and 'aprobado' or 'rechazado','revision_motivo',reason,'revision_por',actor,'revision_fecha',at)
redis.call('XADD',p..'conductores:revisiones','*','usuario_id',id,'accion',action,'motivo',reason,'administrador',actor,'fecha',at)
return 'OK'
