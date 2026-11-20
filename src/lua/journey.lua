-- All lifecycle checks and writes are serialized by Redis. Server time is authoritative.
local p, uid, action, id = ARGV[1], ARGV[2], ARGV[3], ARGV[4]
local input, nonce = cjson.decode(ARGV[5]), ARGV[6]
local now = tonumber(redis.call('TIME')[1])
local function typed(k,t) local v=redis.call('TYPE',k).ok; if v~='none' and v~=t then error('Invalid Redis type: '..k) end end
local function userkey(u) return p..'usuario:'..u end
local function active(u) return p..'activo:'..u end
local function history(u) return p..'historial:'..u end
local function fail(code) return {'error',code} end
typed(userkey(uid),'hash'); typed(active(uid),'string'); typed(history(uid),'set')
typed(p..'contador:viajes','string'); typed(p..'contador:ofertas','string')
typed(p..'viajes:pendientes','set'); typed(p..'viajes:plazos','zset')
typed(p..'viajes:eventos','stream'); typed(p..'ranking:conductores','zset')
local role=redis.call('HGET',userkey(uid),'rol')
local approved=redis.call('HGET',userkey(uid),'aprobado')
if not role or (role=='conductor' and approved~='1') then return fail('PERMISO') end
local requestkey=p..'peticion:'..uid..':'..nonce
if nonce~='' then
  typed(requestkey,'string')
  local old=redis.call('GET',requestkey)
  if old then
    local r=cjson.decode(old)
    if r.action~=action or r.target~=id or r.body~=ARGV[5] then return fail('PETICION_REUTILIZADA') end
    return {'ok',r.id}
  end
end
local function remember(jid)
  if nonce~='' then redis.call('SET',requestkey,cjson.encode({action=action,target=id,body=ARGV[5],id=jid})) end
end
local function event(j,from,to,kind,offerId)
  local timed=kind=='reserva_vencida' or kind=='oferta_vencida' or kind=='busqueda_vencida' or kind=='falta_de_inicio'
  redis.call('XADD',p..'viajes:eventos','*','viaje',j.id,'actor',timed and 'sistema' or uid,'rol',timed and 'sistema' or role,'anterior',from,'nuevo',to,'accion',kind,'fecha',now,'oferta',offerId or (j.oferta and j.oferta.id or ''))
end
if action=='crear' then
  if role~='pasajero' then return fail('PERMISO') end
  if redis.call('EXISTS',active(uid))==1 then return fail('OCUPADO') end
  local nextid=tostring(tonumber(redis.call('GET',p..'contador:viajes') or '0')+1)
  typed(p..'viaje:'..nextid,'hash')
  local jid=tostring(redis.call('INCR',p..'contador:viajes'))
  local j={id=jid,pasajero=uid,estado='pendiente',origen=input.origen,destino=input.destino,creado=now,busqueda_hasta=now+600,pago='pendiente',incidencias={},excluidos={}}
  redis.call('HSET',p..'viaje:'..jid,'datos',cjson.encode(j))
  redis.call('SET',active(uid),jid); redis.call('SADD',history(uid),jid)
  redis.call('SADD',p..'viajes:pendientes',jid); redis.call('ZADD',p..'viajes:plazos',now+600,jid)
  event(j,'','pendiente','crear'); remember(jid); return {'ok',jid}
end
local key=p..'viaje:'..id
typed(key,'hash')
local raw=redis.call('HGET',key,'datos')
if not raw then return fail('NO_EXISTE') end
local j=cjson.decode(raw)
typed(active(j.pasajero),'string'); typed(history(j.pasajero),'set')
if j.conductor then typed(active(j.conductor),'string'); typed(history(j.conductor),'set'); typed(userkey(j.conductor),'hash') end
if j.oferta then typed(p..'oferta:'..j.oferta.id,'hash') end
local participant=uid==j.pasajero or uid==j.conductor
if action~='sincronizar' and action~='reservar' and not participant then return fail('PERMISO') end
local function save()
  redis.call('HSET',key,'datos',cjson.encode(j))
  if j.oferta then redis.call('HSET',p..'oferta:'..j.oferta.id,'datos',cjson.encode(j.oferta)) end
  redis.call('ZREM',p..'viajes:plazos',id)
  local deadline=nil
  if j.estado=='pendiente' then deadline=j.busqueda_hasta
  elseif j.estado=='reservado' then deadline=j.reserva_hasta
  elseif j.estado=='ofertado' then deadline=j.oferta.vence
  elseif j.estado=='confirmado' then deadline=j.inicio_hasta end
  if deadline then redis.call('ZADD',p..'viajes:plazos',deadline,id) end
end
local function releaseDriver()
  if j.conductor and redis.call('GET',active(j.conductor))==id then redis.call('DEL',active(j.conductor)) end
end
local function close(state,reason,offerId)
  local previous=j.estado; j.estado=state; j.motivo=reason; j.terminado=now
  releaseDriver()
  if redis.call('GET',active(j.pasajero))==id then redis.call('DEL',active(j.pasajero)) end
  redis.call('SREM',p..'viajes:pendientes',id)
  event(j,previous,state,reason,offerId)
end
local function reopen(reason)
  local previous=j.estado
  local previousOffer=j.oferta and j.oferta.id or ''
  j.excluidos[j.conductor]=true
  releaseDriver()
  if j.oferta then j.oferta.estado=reason; redis.call('HSET',p..'oferta:'..j.oferta.id,'datos',cjson.encode(j.oferta)) end
  j.conductor=nil; j.oferta=nil; j.reserva_hasta=nil
  if now>=j.busqueda_hasta then close('sin_conductor',reason,previousOffer)
  else j.estado='pendiente'; redis.call('SADD',p..'viajes:pendientes',id); event(j,previous,'pendiente',reason,previousOffer) end
end
if j.estado=='pendiente' and now>=j.busqueda_hasta then close('sin_conductor','busqueda_vencida'); save()
elseif j.estado=='reservado' and now>=j.reserva_hasta then reopen('reserva_vencida'); save()
elseif j.estado=='ofertado' and now>=j.oferta.vence then reopen('oferta_vencida'); save()
elseif j.estado=='confirmado' and now>=j.inicio_hasta then close('cancelado','falta_de_inicio'); save() end
if action=='sincronizar' then return {'ok',id} end
if action=='reservar' then
  if role~='conductor' then return fail('PERMISO') end
  if j.estado~='pendiente' then return fail('ESTADO') end
  if redis.call('HGET',userkey(uid),'disponible')~='1' or redis.call('EXISTS',active(uid))==1 then return fail('OCUPADO') end
  if j.excluidos[uid] then return fail('EXCLUIDO') end
  j.conductor=uid; j.estado='reservado'; j.reserva_hasta=now+60
  redis.call('SET',active(uid),id); redis.call('SREM',p..'viajes:pendientes',id)
  event(j,'pendiente',j.estado,action)
elseif action=='ofertar' then
  if uid~=j.conductor or role~='conductor' then return fail('PERMISO') end
  if j.estado~='reservado' then return fail('ESTADO') end
  local nextoffer=tostring(tonumber(redis.call('GET',p..'contador:ofertas') or '0')+1)
  typed(p..'oferta:'..nextoffer,'hash')
  j.oferta={id=tostring(redis.call('INCR',p..'contador:ofertas')),conductor=uid,autor=uid,importe=input.importe,creado=now,vence=now+300,estado='pendiente'}
  j.estado='ofertado'; event(j,'reservado',j.estado,action)
elseif action=='contraofertar' then
  if j.estado~='ofertado' or j.oferta.id~=input.oferta_id then return fail('ESTADO') end
  if uid==(j.oferta.autor or j.conductor) then return fail('PERMISO') end
  local nextoffer=tostring(tonumber(redis.call('GET',p..'contador:ofertas') or '0')+1)
  typed(p..'oferta:'..nextoffer,'hash')
  j.oferta.estado='contraofertada'; redis.call('HSET',p..'oferta:'..j.oferta.id,'datos',cjson.encode(j.oferta))
  j.oferta={id=tostring(redis.call('INCR',p..'contador:ofertas')),conductor=j.conductor,autor=uid,importe=input.importe,creado=now,vence=j.oferta.vence,estado='pendiente'}
  event(j,'ofertado','ofertado',action)
elseif action=='aceptar-oferta' or action=='rechazar-oferta' then
  if j.estado~='ofertado' or j.oferta.id~=input.oferta_id then return fail('ESTADO') end
  if uid==(j.oferta.autor or j.conductor) then return fail('PERMISO') end
  if action=='rechazar-oferta' then reopen('rechazada')
  else
    j.oferta.estado='aceptada'; j.estado='confirmado'; j.precio=j.oferta.importe; j.confirmado=now; j.inicio_hasta=now+1800
    redis.call('SADD',history(j.conductor),id); event(j,'ofertado',j.estado,action)
  end
elseif action=='cancelar' then
  if j.estado~='pendiente' and j.estado~='reservado' and j.estado~='ofertado' and j.estado~='confirmado' then return fail('ESTADO') end
  j.comentario_cancelacion=input.comentario; j.cancelado_por=uid
  if j.oferta and j.oferta.estado=='pendiente' then j.oferta.estado='cancelada' end
  close('cancelado',input.motivo)
elseif action=='iniciar' then
  if role~='conductor' or uid~=j.conductor then return fail('PERMISO') end
  if j.estado~='confirmado' then return fail('ESTADO') end
  j.estado='en_curso'; j.iniciado=now; event(j,'confirmado',j.estado,action)
elseif action=='finalizar' then
  if role~='conductor' or uid~=j.conductor then return fail('PERMISO') end
  if j.estado~='en_curso' then return fail('ESTADO') end
  close('finalizado','viaje_finalizado'); redis.call('ZINCRBY',p..'ranking:conductores',1,uid)
elseif action=='registrar-pago' then
  if role~='conductor' or uid~=j.conductor then return fail('PERMISO') end
  if j.estado~='finalizado' then return fail('ESTADO') end
  if j.pago~='pendiente' then
    if j.pago~=input.metodo then return fail('PAGO_REGISTRADO') end
  else j.pago=input.metodo; j.pagado=now; event(j,j.estado,j.estado,action) end
elseif action=='registrar-incidencia' then
  if j.estado~='en_curso' then return fail('ESTADO') end
  table.insert(j.incidencias,{autor=uid,rol=role,motivo=input.motivo,comentario=input.comentario,fecha=now})
  event(j,j.estado,j.estado,action)
else return fail('ACCION') end
save(); remember(id); return {'ok',id}
