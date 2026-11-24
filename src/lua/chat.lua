-- Chat between the passenger and the confirmed driver of one journey.
-- ARGV: prefix, uid, journey id, text, request id. Validation and XADD run atomically.
local p,uid,id,text,nonce=ARGV[1],ARGV[2],ARGV[3],ARGV[4],ARGV[5]
local now=tonumber(redis.call('TIME')[1])
local function typed(k,t) local v=redis.call('TYPE',k).ok; if v~='none' and v~=t then error('Invalid Redis type: '..k) end end
local function fail(code) return {'error',code} end
local userkey=p..'usuario:'..uid
local key=p..'viaje:'..id
local chat=p..'chat:'..id
local requestkey=p..'peticion-chat:'..uid..':'..nonce
typed(userkey,'hash'); typed(key,'hash'); typed(chat,'stream'); typed(requestkey,'string')
local role=redis.call('HGET',userkey,'rol')
if not role or (role=='conductor' and redis.call('HGET',userkey,'aprobado')~='1') then return fail('PERMISO') end
local raw=redis.call('HGET',key,'datos')
if not raw then return fail('NO_EXISTE') end
local j=cjson.decode(raw)
if uid~=j.pasajero and uid~=j.conductor then return fail('PERMISO') end
local old=redis.call('GET',requestkey)
if old then
  local r=cjson.decode(old)
  if r.viaje~=id or r.texto~=text then return fail('PETICION_REUTILIZADA') end
  return {'ok',r.mensaje}
end
if j.estado~='confirmado' and j.estado~='en_curso' then return fail('CHAT_CERRADO') end
local mid=redis.call('XADD',chat,'MAXLEN','~','200','*','autor',uid,'rol',role,'texto',text,'fecha',tostring(now))
redis.call('SET',requestkey,cjson.encode({viaje=id,texto=text,mensaje=mid}),'EX',86400)
return {'ok',mid}
