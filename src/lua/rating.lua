-- Passenger rates the driver once, after the journey is finished.
-- ARGV: prefix, uid, journey id, JSON {estrellas, etiquetas, comentario}, request id.
local p,uid,id,body,nonce=ARGV[1],ARGV[2],ARGV[3],ARGV[4],ARGV[5]
local input=cjson.decode(body)
local now=tonumber(redis.call('TIME')[1])
local function typed(k,t) local v=redis.call('TYPE',k).ok; if v~='none' and v~=t then error('Invalid Redis type: '..k) end end
local function fail(code) return {'error',code} end
local key=p..'viaje:'..id
local requestkey=p..'peticion-calificar:'..uid..':'..nonce
typed(key,'hash'); typed(requestkey,'string'); typed(p..'viajes:eventos','stream')
local raw=redis.call('HGET',key,'datos')
if not raw then return fail('NO_EXISTE') end
local j=cjson.decode(raw)
if uid~=j.pasajero then return fail('PERMISO') end
local old=redis.call('GET',requestkey)
if old then
  if old~=id..':'..body then return fail('PETICION_REUTILIZADA') end
  return {'ok',id}
end
if j.estado~='finalizado' or not j.conductor then return fail('ESTADO') end
if j.calificacion then return fail('YA_CALIFICADO') end
local stats=p..'calificaciones:'..j.conductor
typed(stats,'hash')
j.calificacion={estrellas=input.estrellas,etiquetas=input.etiquetas,comentario=input.comentario,fecha=now}
redis.call('HSET',key,'datos',cjson.encode(j))
redis.call('HINCRBY',stats,'suma',input.estrellas)
redis.call('HINCRBY',stats,'cantidad',1)
redis.call('XADD',p..'viajes:eventos','*','viaje',j.id,'actor',uid,'rol','pasajero','anterior',j.estado,'nuevo',j.estado,'accion','calificar','fecha',now,'oferta','')
redis.call('SET',requestkey,id..':'..body,'EX',86400)
return {'ok',id}
