-- Version 2: independent proposals; only accepting an offer assigns the driver.
local p,uid,action,id=ARGV[1],ARGV[2],ARGV[3],ARGV[4]
local input,nonce=cjson.decode(ARGV[5]),ARGV[6]
local now=tonumber(redis.call('TIME')[1])
local function typed(k,t) local v=redis.call('TYPE',k).ok; if v~='none' and v~=t then error('Invalid Redis type: '..k) end end
local function active(u) return p..'activo:'..u end
local function user(u) return p..'usuario:'..u end
local function history(u) return p..'historial:'..u end
local function fail(code) return {'error',code} end
typed(user(uid),'hash'); typed(active(uid),'string'); typed(history(uid),'set')
typed(p..'contador:viajes','string'); typed(p..'contador:ofertas','string')
typed(p..'viajes:pendientes','set'); typed(p..'viajes:plazos','zset')
typed(p..'viajes:eventos','stream'); typed(p..'ranking:conductores','zset')
local role=redis.call('HGET',user(uid),'rol')
if not role or (role=='conductor' and redis.call('HGET',user(uid),'aprobado')~='1') then return fail('PERMISO') end
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
  redis.call('XADD',p..'viajes:eventos','*','viaje',j.id,'actor',timed and 'sistema' or uid,'rol',timed and 'sistema' or role,'anterior',from,'nuevo',to,'accion',kind,'fecha',now,'oferta',offerId or '')
end
if action=='crear' then
  if role~='pasajero' then return fail('PERMISO') end
  if redis.call('EXISTS',active(uid))==1 then return fail('OCUPADO') end
  local nextid=tostring(tonumber(redis.call('GET',p..'contador:viajes') or '0')+1)
  typed(p..'viaje:'..nextid,'hash')
  local jid=tostring(redis.call('INCR',p..'contador:viajes'))
  local j={version=2,id=jid,pasajero=uid,estado='pendiente',origen=input.origen,destino=input.destino,creado=now,busqueda_hasta=now+600,pago='pendiente',incidencias={},excluidos={},participaciones={}}
  redis.call('HSET',p..'viaje:'..jid,'datos',cjson.encode(j))
  redis.call('SET',active(uid),jid); redis.call('SADD',history(uid),jid)
  redis.call('SADD',p..'viajes:pendientes',jid); redis.call('ZADD',p..'viajes:plazos',j.busqueda_hasta,jid)
  event(j,'','pendiente','crear'); remember(jid); return {'ok',jid}
end
local key=p..'viaje:'..id
typed(key,'hash')
local raw=redis.call('HGET',key,'datos')
if not raw then return fail('NO_EXISTE') end
local j=cjson.decode(raw)
typed(active(j.pasajero),'string'); typed(history(j.pasajero),'set')
for driver,entry in pairs(j.participaciones) do
  typed(active(driver),'string'); typed(history(driver),'set'); typed(user(driver),'hash')
  if entry.oferta then typed(p..'oferta:'..entry.oferta.id,'hash') end
end
local entry=j.participaciones[uid]
if action~='sincronizar' and action~='reservar' and uid~=j.pasajero and not entry then return fail('PERMISO') end
local function release(driver)
  if redis.call('GET',active(driver))==id then redis.call('DEL',active(driver)) end
end
local function writeOffer(e)
  if e.oferta then redis.call('HSET',p..'oferta:'..e.oferta.id,'datos',cjson.encode(e.oferta)) end
end
local function endEntry(driver,e,reason)
  e.estado=reason
  if e.oferta and e.oferta.estado=='pendiente' then e.oferta.estado=reason; writeOffer(e) end
  release(driver)
end
local function save()
  redis.call('HSET',key,'datos',cjson.encode(j))
  redis.call('ZREM',p..'viajes:plazos',id)
  local deadline=nil
  if j.estado=='pendiente' then
    if now<j.busqueda_hasta then deadline=j.busqueda_hasta end
    for _,e in pairs(j.participaciones) do
      local d=e.estado=='reservado' and e.reserva_hasta or (e.estado=='ofertado' and e.oferta.vence)
      if d and (not deadline or d<deadline) then deadline=d end
    end
  elseif j.estado=='confirmado' then deadline=j.inicio_hasta end
  if deadline then redis.call('ZADD',p..'viajes:plazos',deadline,id) end
end
local function close(state,reason)
  local previous=j.estado; j.estado=state; j.motivo=reason; j.terminado=now
  for driver,e in pairs(j.participaciones) do
    if e.estado=='reservado' or e.estado=='ofertado' then endEntry(driver,e,reason) end
  end
  if j.conductor then release(j.conductor) end
  release(j.pasajero); redis.call('SREM',p..'viajes:pendientes',id)
  event(j,previous,state,reason,j.oferta and j.oferta.id)
end
if j.estado=='pendiente' then
  local live=false
  for driver,e in pairs(j.participaciones) do
    local reason=nil
    if e.estado=='reservado' and now>=e.reserva_hasta then reason='reserva_vencida'
    elseif e.estado=='ofertado' and now>=e.oferta.vence then reason='oferta_vencida' end
    if reason then endEntry(driver,e,reason); j.excluidos[driver]=true; event(j,'pendiente','pendiente',reason,e.oferta and e.oferta.id) end
    if e.estado=='reservado' or e.estado=='ofertado' then live=true end
  end
  if now>=j.busqueda_hasta then
    redis.call('SREM',p..'viajes:pendientes',id)
    if not live then close('sin_conductor','busqueda_vencida') end
  end
  save()
elseif j.estado=='confirmado' and now>=j.inicio_hasta then close('cancelado','falta_de_inicio'); save() end
if action=='sincronizar' then return {'ok',id} end
if action=='reservar' then
  if role~='conductor' then return fail('PERMISO') end
  if j.estado~='pendiente' or now>=j.busqueda_hasta then return fail('ESTADO') end
  if j.excluidos[uid] then return fail('EXCLUIDO') end
  if redis.call('HGET',user(uid),'disponible')~='1' or redis.call('EXISTS',active(uid))==1 then return fail('OCUPADO') end
  j.participaciones[uid]={estado='reservado',reserva_hasta=now+60}
  redis.call('SET',active(uid),id)
  event(j,'pendiente','pendiente','preparar_propuesta')
elseif action=='ofertar' then
  if role~='conductor' or not entry then return fail('PERMISO') end
  if j.estado~='pendiente' or entry.estado~='reservado' then return fail('ESTADO') end
  local nextoffer=tostring(tonumber(redis.call('GET',p..'contador:ofertas') or '0')+1)
  typed(p..'oferta:'..nextoffer,'hash')
  entry.oferta={id=tostring(redis.call('INCR',p..'contador:ofertas')),conductor=uid,autor=uid,importe=input.importe,creado=now,vence=now+300,estado='pendiente'}
  entry.estado='ofertado'; writeOffer(entry)
  event(j,'pendiente','pendiente',action,entry.oferta.id)
elseif action=='contraofertar' or action=='aceptar-oferta' or action=='rechazar-oferta' then
  if j.estado~='pendiente' then return fail('ESTADO') end
  local driver,e=nil,nil
  for d,v in pairs(j.participaciones) do
    if v.oferta and v.oferta.id==input.oferta_id then driver=d; e=v; break end
  end
  if not e then return fail('ESTADO') end
  if uid~=j.pasajero and uid~=driver then return fail('PERMISO') end
  if e.estado~='ofertado' or e.oferta.estado~='pendiente' then return fail('ESTADO') end
  if uid==e.oferta.autor then return fail('PERMISO') end
  if action=='rechazar-oferta' then
    endEntry(driver,e,'rechazada'); j.excluidos[driver]=true
    event(j,'pendiente','pendiente',action,e.oferta.id)
  elseif action=='contraofertar' then
    local nextoffer=tostring(tonumber(redis.call('GET',p..'contador:ofertas') or '0')+1)
    typed(p..'oferta:'..nextoffer,'hash')
    local deadline=e.oferta.vence
    e.oferta.estado='contraofertada'; writeOffer(e)
    e.oferta={id=tostring(redis.call('INCR',p..'contador:ofertas')),conductor=driver,autor=uid,importe=input.importe,creado=now,vence=deadline,estado='pendiente'}
    writeOffer(e); event(j,'pendiente','pendiente',action,e.oferta.id)
  else
    if redis.call('GET',active(driver))~=id or redis.call('GET',active(j.pasajero))~=id then return fail('OCUPADO') end
    e.oferta.estado='aceptada'; writeOffer(e); e.estado='elegido'
    j.conductor=driver; j.oferta=e.oferta; j.precio=e.oferta.importe; j.estado='confirmado'; j.confirmado=now; j.inicio_hasta=now+1800
    for other,v in pairs(j.participaciones) do
      if other~=driver and (v.estado=='reservado' or v.estado=='ofertado') then endEntry(other,v,'no_elegido') end
    end
    redis.call('SREM',p..'viajes:pendientes',id); redis.call('SADD',history(driver),id)
    event(j,'pendiente','confirmado',action,e.oferta.id)
  end
elseif action=='cancelar' then
  if j.estado=='pendiente' and uid~=j.pasajero then
    if not entry or (entry.estado~='reservado' and entry.estado~='ofertado') then return fail('ESTADO') end
    endEntry(uid,entry,'retirada'); j.excluidos[uid]=true
    event(j,'pendiente','pendiente','retirar_propuesta',entry.oferta and entry.oferta.id)
  else
    if uid~=j.pasajero and uid~=j.conductor then return fail('PERMISO') end
    if j.estado~='pendiente' and j.estado~='confirmado' then return fail('ESTADO') end
    j.comentario_cancelacion=input.comentario; j.cancelado_por=uid
    if j.oferta then
      j.oferta.estado='cancelada'; j.participaciones[j.conductor].oferta=j.oferta
      writeOffer(j.participaciones[j.conductor])
    end
    close('cancelado',input.motivo)
  end
elseif action=='iniciar' then
  if role~='conductor' or uid~=j.conductor then return fail('PERMISO') end
  if j.estado~='confirmado' then return fail('ESTADO') end
  j.estado='en_curso'; j.iniciado=now; event(j,'confirmado','en_curso',action)
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
  if uid~=j.pasajero and uid~=j.conductor then return fail('PERMISO') end
  if j.estado~='en_curso' then return fail('ESTADO') end
  table.insert(j.incidencias,{autor=uid,rol=role,motivo=input.motivo,comentario=input.comentario,fecha=now})
  event(j,j.estado,j.estado,action)
else return fail('ACCION') end
-- Rejection/withdrawal may remove the last outstanding proposal after search expiry.
if j.estado=='pendiente' and now>=j.busqueda_hasta then
  local live=false
  for _,e in pairs(j.participaciones) do if e.estado=='reservado' or e.estado=='ofertado' then live=true end end
  if not live then close('sin_conductor','busqueda_vencida') end
end
save(); remember(id); return {'ok',id}
