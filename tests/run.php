<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Store,Accounts,Journeys,Practice,ApiError};
$prefix='sicuani-tests:'.bin2hex(random_bytes(12)).':';
$store=new Store($prefix,15); $r=$store->redis; $accounts=new Accounts($store); $journeys=new Journeys($store);$count=0;
function check(bool $condition,string $name): void {global $count;if(!$condition)throw new RuntimeException('FAIL: '.$name);echo 'PASS: '.$name.PHP_EOL;$count++;}
function rejects(callable $fn,string $kind,string $name):void {try{$fn();}catch(ApiError $e){check($e->kind===$kind,$name.' ['.$e->kind.']');return;}throw new RuntimeException('FAIL (accepted): '.$name);}
function nonce():string{return bin2hex(random_bytes(16));}
function expire(Journeys $journeys,Store $store,string $id,string $field):void {
 $j=json_decode($store->redis->hget($store->prefix.'viaje:'.$id,'datos'),true);
 if($field==='oferta')$j['oferta']['vence']=time()-1;else $j[$field]=time()-1;
 $store->redis->hset($store->prefix.'viaje:'.$id,'datos',json_encode($j));
 $store->redis->zadd($store->prefix.'viajes:plazos',[ $id=>time()-1 ]);
}
try {
 check((string)$r->ping()==='PONG','PHP conecta con Redis real');
 $pass=$accounts->create(['nombre'=>'Pasajero Prueba','usuario'=>'prueba','telefono'=>'987654001','password'=>'Prueba-segura-123']);
 $pass2=$accounts->create(['nombre'=>'Segundo Pasajero','usuario'=>'segundo','telefono'=>'987654004','password'=>'Prueba-segura-123']);
 $d=[];for($i=1;$i<=2;$i++){$d[$i]=$accounts->create(['nombre'=>'Conductor '.$i,'usuario'=>'driver'.$i,'telefono'=>'98765400'.($i+1),'password'=>'Prueba-segura-123','placa'=>'XAB-12'.$i,'color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],'conductor');$r->hset($prefix.'usuario:'.$d[$i]['id'],'disponible','1');}
 check(password_verify('Prueba-segura-123',$pass['password']),'Contraseñas con hash verificable');
 rejects(fn()=>$accounts->create(['nombre'=>'Otro','usuario'=>' PRUEBA ','telefono'=>'987654005','password'=>'Prueba-segura-123']),'DUPLICADO','Usuario normalizado único');
 rejects(fn()=>$accounts->create(['nombre'=>'Otro','usuario'=>'otro','telefono'=>'+51 987 654 001','password'=>'Prueba-segura-123']),'DUPLICADO','Teléfono normalizado único');
 foreach ([['usuario'=>' PRUEBA ','telefono'=>'987654005','expected'=>'nombre de usuario'],['usuario'=>'chofer_nuevo','telefono'=>'+51 987 654 001','expected'=>'número de celular']] as $case) {
  try { $accounts->create(['nombre'=>'Chofer Prueba','usuario'=>$case['usuario'],'telefono'=>$case['telefono'],'password'=>'Prueba-segura-123','placa'=>'ABC-123','color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],'conductor',false,false); throw new RuntimeException('FAIL: duplicado aceptado'); }
  catch (ApiError $e) { check($e->kind==='DUPLICADO' && str_contains($e->getMessage(),$case['expected']),'Registro indica el campo duplicado: '.$case['expected']); }
 }
 $newDriver=$accounts->create(['nombre'=>'Chofer Nuevo','usuario'=>'chofer_nuevo','telefono'=>'987654005','password'=>'Prueba-segura-123','placa'=>'ABC-123','color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],'conductor',false,false);
 check($newDriver['rol']==='conductor' && $newDriver['aprobado']==='0','Chofer con usuario y celular nuevos se registra pendiente');
 rejects(fn()=>$accounts->login('prueba','incorrecta'),'CREDENCIALES','Contraseña incorrecta rechazada');
 $points=['origen'=>['lat'=>-14.2714,'lng'=>-71.2292,'nombre'=>'Plaza Sicuani'],'destino'=>['lat'=>-14.2755,'lng'=>-71.2351,'nombre'=>'Estadio']];
 // Keep coverage for pre-existing version 1 journeys during the transition.
 $legacyNew=function(string $uid,string $request)use($store,$journeys,$points):array {
  $result=$store->run('journey',[$uid,'crear','',json_encode($points,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE),$request]);
  if($result[0]!=='ok')throw new ApiError($result[1],'Solicitud rechazada.',409);
  return $journeys->get($uid,$result[1]);
 };
 $new=fn(string $uid)=>$legacyNew($uid,nonce());
 $action=fn(string $uid,string $name,string $id,array $body=[])=>$journeys->action($uid,$name,$id,$body,nonce());
 $request=nonce();$j=$legacyNew($pass['id'],$request);$id=$j['id'];
 check($legacyNew($pass['id'],$request)['id']===$id,'Crear viaje heredado es idempotente');
 rejects(fn()=>$new($pass['id']),'OCUPADO','Un viaje activo por pasajero');
 rejects(fn()=>$journeys->get($pass2['id'],$id),'PERMISO','Consulta de otro pasajero bloqueada');
 check(count($journeys->pending($d[1]['id']))===1,'Solicitud visible para conductor disponible');
 $procs=[];foreach($d as $u){$pipes=[];$proc=proc_open([PHP_BINARY,__DIR__.'/worker.php',$prefix,$u['id'],$id],[1=>['pipe','w'],2=>['pipe','w']],$pipes);$procs[]=[$proc,$pipes];}
 $results=[];foreach($procs as [$proc,$pipes]){$results[]=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($proc)!==0)throw new RuntimeException($err);}
 check(count(array_filter($results,fn($v)=>$v==='won'))===1,'Dos procesos concurrentes: una única reserva ganadora');
 $j=$journeys->get($pass['id'],$id);$driver=$j['conductor'];$other=$d[1]['id']===$driver?$d[2]['id']:$d[1]['id'];
 check(!isset($j['conductor_info']),'Identidad del vehículo oculta antes de oferta');
 $j2=$new($pass2['id']);rejects(fn()=>$action($driver,'reservar',$j2['id']),'OCUPADO','Un conductor no reserva dos viajes');
 $offerNonce=nonce();$j=$journeys->action($driver,'ofertar',$id,['importe'=>1250],$offerNonce);
 check($journeys->action($driver,'ofertar',$id,['importe'=>1250],$offerNonce)['oferta']['id']===$j['oferta']['id'],'Reintento de precio conserva la misma oferta');
 check(isset($j['conductor_info']['placa']),'Placa y color visibles desde la oferta');
 $firstOffer=$j['oferta']['id'];$offerDeadline=$j['oferta']['vence'];
 rejects(fn()=>$action($driver,'contraofertar',$id,['importe'=>1100,'oferta_id'=>$firstOffer]),'PERMISO','El autor espera la respuesta de la otra parte');
 $counterNonce=nonce();$j=$journeys->action($pass['id'],'contraofertar',$id,['importe'=>1100,'oferta_id'=>$firstOffer],$counterNonce);
 check($j['oferta']['autor']===$pass['id'] && $j['oferta']['vence']===$offerDeadline && $j['oferta']['importe']===1100,'Pasajero contraoferta sin ampliar plazo');
 check($journeys->action($pass['id'],'contraofertar',$id,['importe'=>1100,'oferta_id'=>$firstOffer],$counterNonce)['oferta']['id']===$j['oferta']['id'],'Reintento de contraoferta es idempotente');
 rejects(fn()=>$action($driver,'aceptar-oferta',$id,['oferta_id'=>$firstOffer]),'ESTADO','No se acepta una oferta anterior');
 rejects(fn()=>$action($pass['id'],'aceptar-oferta',$id,['oferta_id'=>$j['oferta']['id']]),'PERMISO','No se acepta la propuesta propia');
 $j=$action($driver,'contraofertar',$id,['importe'=>1200,'oferta_id'=>$j['oferta']['id']]);
 check($j['oferta']['autor']===$driver && $j['oferta']['importe']===1200,'Conductor puede responder con otra propuesta');
 rejects(fn()=>$action($other,'iniciar',$id),'PERMISO','Otro conductor no opera el viaje');
 $originalDeadline=$j['busqueda_hasta'];
 $reopened=$action($pass['id'],'rechazar-oferta',$id,['oferta_id'=>$j['oferta']['id']]);
 check($reopened['busqueda_hasta']===$originalDeadline,'Rechazo conserva el plazo original de búsqueda');
 rejects(fn()=>$action($driver,'reservar',$id),'EXCLUIDO','Conductor rechazado queda excluido');
 $action($other,'reservar',$id);$j=$action($other,'ofertar',$id,['importe'=>1500]);
 $j=$action($pass['id'],'aceptar-oferta',$id,['oferta_id'=>$j['oferta']['id']]);check($j['estado']==='confirmado'&&$j['precio']===1500,'Oferta aceptada fija conductor y precio');
 $r->hset($prefix.'usuario:'.$other,'disponible','0');$j=$action($other,'iniciar',$id);check($j['estado']==='en_curso','No disponible conserva el viaje actual');
 rejects(fn()=>$action($pass['id'],'cancelar',$id,['motivo'=>'cambio_de_planes']),'ESTADO','Viaje iniciado no admite cancelación normal');
 $j=$action($pass['id'],'registrar-incidencia',$id,['motivo'=>'problema_durante_viaje','comentario'=>'Incidencia de prueba']);check(count($j['incidencias'])===1&&$j['estado']==='en_curso','Incidencia conserva estado del viaje');
 $finishNonce=nonce();$j=$journeys->action($other,'finalizar',$id,[],$finishNonce);$journeys->action($other,'finalizar',$id,[],$finishNonce);
 check($j['estado']==='finalizado'&&$j['pago']==='pendiente','Finaliza con pago pendiente');
 check((int)$r->zscore($prefix.'ranking:conductores',$other)===1,'Ranking incrementado una vez ante reintento');
 $events=$r->xlen($prefix.'viajes:eventos');$j=$action($other,'registrar-pago',$id,['metodo'=>'yape']);$action($other,'registrar-pago',$id,['metodo'=>'yape']);
 check($j['pago']==='yape'&&$r->xlen($prefix.'viajes:eventos')===$events+1,'Pago posterior idempotente, un solo evento');
 rejects(fn()=>$action($other,'registrar-pago',$id,['metodo'=>'efectivo']),'PAGO_REGISTRADO','Pago registrado no cambia de método');
 check(count($journeys->history($pass['id']))===1,'Historial persistente del pasajero');
 check($journeys->active($pass['id'])===null&&$journeys->active($other)===null,'Finalizar libera ambos índices activos');
 $action($pass2['id'],'cancelar',$j2['id'],['motivo'=>'cambio_de_planes']);
 foreach($d as $u)$r->hset($prefix.'usuario:'.$u['id'],'disponible','1');
 $j=$new($pass['id']);$id=$j['id'];$action($driver,'reservar',$id);expire($journeys,$store,$id,'reserva_hasta');$j=$journeys->get($pass['id'],$id);
 check($j['estado']==='pendiente'&&$journeys->active($driver)===null,'Reserva de un minuto vencida reabre y libera');
 rejects(fn()=>$action($driver,'reservar',$id),'EXCLUIDO','Reserva vencida excluye conductor');
 $action($other,'reservar',$id);$j=$action($other,'ofertar',$id,['importe'=>1200]);$oldOffer=$j['oferta']['id'];expire($journeys,$store,$id,'oferta');
 rejects(fn()=>$action($pass['id'],'aceptar-oferta',$id,['oferta_id'=>$oldOffer]),'ESTADO','Oferta vencida no puede aceptarse');
 $events=$r->executeRaw(['XREVRANGE',$prefix.'viajes:eventos','+','-','COUNT','1']);
 $fields=[];for($i=0;$i<count($events[0][1]);$i+=2)$fields[$events[0][1][$i]]=$events[0][1][$i+1];
 check($fields['actor']==='sistema'&&$fields['oferta']===$oldOffer,'Vencimiento registra actor sistema y oferta correspondiente');
 $action($pass['id'],'cancelar',$id,['motivo'=>'cambio_de_planes']);
 $j=$new($pass['id']);$id=$j['id'];expire($journeys,$store,$id,'busqueda_hasta');$j=$journeys->get($pass['id'],$id);check($j['estado']==='sin_conductor','Búsqueda de diez minutos finaliza sin conductor');
 $j=$new($pass['id']);$id=$j['id'];$action($driver,'reservar',$id);$j=$action($driver,'ofertar',$id,['importe'=>1000]);expire($journeys,$store,$id,'busqueda_hasta');$j=$action($pass['id'],'aceptar-oferta',$id,['oferta_id'=>$j['oferta']['id']]);check($j['estado']==='confirmado','Oferta vigente se acepta después del plazo original de búsqueda');
 expire($journeys,$store,$id,'inicio_hasta');$j=$journeys->get($pass['id'],$id);check($j['estado']==='cancelado'&&$j['motivo']==='falta_de_inicio','Treinta minutos sin inicio cancela y conserva motivo');
 $j=$new($pass['id']);$id=$j['id'];$action($driver,'reservar',$id);expire($journeys,$store,$id,'busqueda_hasta');$j=$action($driver,'ofertar',$id,['importe'=>1000]);
 check($j['estado']==='ofertado','Reserva vigente conserva su minuto para ofertar después de búsqueda');
 expire($journeys,$store,$id,'oferta');$j=$journeys->get($pass['id'],$id);
 check($j['estado']==='sin_conductor'&&$journeys->active($driver)===null,'Oferta vencida después de búsqueda cierra y libera usuarios');
 $practice=new Practice($store);putenv('PRACTICE_ENABLED=1');
 rejects(fn()=>$practice->execute($pass,'consultar'),'PERMISO','Cuenta ordinaria no accede a laboratorio');
 $lab=[...$pass,'practica'=>'1'];
 rejects(fn()=>$practice->execute($lab,'leer'),'GRUPO_PENDIENTE','Lectura sin grupo devuelve una instrucción recuperable');
 $practice->execute($lab,'crear-grupo');$eventId=$practice->execute($lab,'agregar');$messages=$practice->execute($lab,'leer');$pending=$practice->execute($lab,'pendientes');
 check(!empty($messages)&&(int)$pending[0]===1,'Práctica XREADGROUP y XPENDING');
 check($practice->execute($lab,'confirmar',['ids'=>[$eventId]])===1,'Práctica XACK confirma evento');
 check((int)$practice->execute($lab,'pendientes')[0]===0,'Grupo de práctica sin pendientes tras confirmar');
 $r->hset($prefix.'usuario:'.$driver,'aprobado','0');rejects(fn()=>$accounts->login($store->user($driver)['usuario'],'Prueba-segura-123'),'PENDIENTE_APROBACION','Conductor sin aprobación no inicia sesión');
 echo "\n$count verificaciones aprobadas contra Redis real.\n";
} finally {
 // Retain isolated fixtures in database 15 for inspection. Never delete Redis keys here.
 echo 'Fixtures conservados en DB 15; namespace '.$prefix.PHP_EOL;
}
