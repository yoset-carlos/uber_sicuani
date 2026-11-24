<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Store,Accounts,Journeys,Chat,Ratings,ApiError};
// Isolated prefix in DB 15; removes only its own keys at the end.
$store=new Store('sicuani-chat-tests:'.bin2hex(random_bytes(8)).':',15);
$accounts=new Accounts($store);$journeys=new Journeys($store);$chat=new Chat($store);$ratings=new Ratings($store);$count=0;
function check(bool $condition,string $name):void {global $count;if(!$condition)throw new RuntimeException('FAIL: '.$name);$count++;echo 'PASS: '.$name.PHP_EOL;}
function rejects(callable $action,string $kind,string $name):void {try{$action();}catch(ApiError $e){check($e->kind===$kind,$name.' ['.$e->kind.']');return;}throw new RuntimeException('FAIL (aceptado): '.$name);}
function nonce():string {return bin2hex(random_bytes(16));}
$act=fn(string $uid,string $action,string $id,array $body=[])=>$journeys->action($uid,$action,$id,$body,nonce());
$points=['origen'=>['nombre'=>'Plaza de Armas','lat'=>-14.2714,'lng'=>-71.2292],'destino'=>['nombre'=>'Terminal Terrestre','lat'=>-14.28,'lng'=>-71.22]];
$n=0;
$make=function(string $role)use(&$n,$accounts,$store):string {
 $n++;
 $u=$accounts->create(['nombre'=>'Chat Prueba '.$n,'usuario'=>'chat'.$n,'telefono'=>'97'.str_pad((string)$n,7,'0',STR_PAD_LEFT),'password'=>'Prueba-chat-123','placa'=>'CHT-'.$n,'color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],$role);
 if($role==='conductor')$store->redis->hset($store->prefix.'usuario:'.$u['id'],'disponible','1');
 return $u['id'];
};
try {
 $p=$make('pasajero');$d1=$make('conductor');$d2=$make('conductor');$p2=$make('pasajero');
 $id=$act($p,'crear','',$points)['id'];
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 $o1=$act($d1,'ofertar',$id,['importe'=>600])['oferta'];$act($d2,'ofertar',$id,['importe'=>700]);
 $offer=$journeys->get($p,$id)['ofertas'][0];
 check(array_key_exists('promedio',$offer['conductor_info']) && $offer['conductor_info']['viajes']===0,'Las propuestas incluyen viajes y promedio del chofer');
 rejects(fn()=>$chat->send($p,$id,['texto'=>'Hola'],nonce()),'CHAT_CERRADO','El chat no abre antes de confirmar');
 $act($p,'aceptar-oferta',$id,['oferta_id'=>$o1['id']]);
 $request=nonce();
 $m1=$chat->send($p,$id,['texto'=>'  Te espero   frente a la catedral '],$request)['id'];
 check($chat->send($p,$id,['texto'=>'  Te espero   frente a la catedral '],$request)['id']===$m1,'Reintentar el envío no duplica el mensaje');
 rejects(fn()=>$chat->send($p,$id,['texto'=>'Otro texto'],$request),'PETICION_REUTILIZADA','Reutilizar la petición con otro texto se rechaza');
 $chat->send($d1,$id,['texto'=>'Llego a la esquina.'],nonce());
 $read=$chat->read($p,$id);
 check(count($read['mensajes'])===2 && $read['abierto'],'Pasajero y chofer confirmado conversan');
 check($read['mensajes'][0]['texto']==='Te espero frente a la catedral','El texto se guarda sin espacios sobrantes');
 check($read['mensajes'][1]['rol']==='conductor' && $read['mensajes'][1]['autor']===$d1,'Cada mensaje guarda autor y rol');
 check(count($chat->read($d1,$id,$m1)['mensajes'])===1,'Leer desde un id devuelve solo los mensajes nuevos');
 rejects(fn()=>$chat->read($d2,$id),'PERMISO','Un chofer no elegido no lee el chat');
 rejects(fn()=>$chat->send($d2,$id,['texto'=>'Hola'],nonce()),'PERMISO','Un chofer no elegido no escribe');
 rejects(fn()=>$chat->read($p2,$id),'PERMISO','Otro pasajero no lee el chat');
 rejects(fn()=>$chat->send($p,$id,['texto'=>'   '],nonce()),'MENSAJE_INVALIDO','Mensaje vacío rechazado');
 rejects(fn()=>$chat->send($p,$id,['texto'=>str_repeat('a',501)],nonce()),'MENSAJE_INVALIDO','Mensaje de más de 500 caracteres rechazado');
 rejects(fn()=>$chat->read($p,$id,'abc'),'DATOS_INVALIDOS','Punto de lectura inválido rechazado');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>5],nonce()),'ESTADO','No se califica antes de finalizar');
 $act($d1,'iniciar',$id);
 $chat->send($d1,$id,['texto'=>'En camino'],nonce());
 check(count($chat->read($p,$id)['mensajes'])===3,'El chat sigue abierto durante el viaje');
 $act($d1,'finalizar',$id);
 rejects(fn()=>$chat->send($p,$id,['texto'=>'Gracias'],nonce()),'CHAT_CERRADO','El chat se cierra al finalizar');
 check(!$chat->read($p,$id)['abierto'] && count($chat->read($p,$id)['mensajes'])===3,'Al finalizar el historial se puede leer');
 rejects(fn()=>$ratings->rate($d1,$id,['estrellas'=>5],nonce()),'PERMISO','El chofer no se califica a sí mismo');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>6],nonce()),'CALIFICACION_INVALIDA','Más de 5 estrellas rechazado');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>'4'],nonce()),'CALIFICACION_INVALIDA','Estrellas como texto rechazadas');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>4,'etiquetas'=>['Inventada']],nonce()),'CALIFICACION_INVALIDA','Etiqueta fuera de la lista rechazada');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>4,'etiquetas'=>['Amable','Amable']],nonce()),'CALIFICACION_INVALIDA','Etiqueta repetida rechazada');
 $request=nonce();
 $ratings->rate($p,$id,['estrellas'=>4,'etiquetas'=>['Puntual','Amable'],'comentario'=>'Muy bien'],$request);
 $ratings->rate($p,$id,['estrellas'=>4,'etiquetas'=>['Puntual','Amable'],'comentario'=>'Muy bien'],$request);
 $j=$journeys->get($p,$id);
 check($j['calificacion']['estrellas']===4 && $j['calificacion']['etiquetas']===['Puntual','Amable'],'La calificación queda en el viaje');
 rejects(fn()=>$ratings->rate($p,$id,['estrellas'=>1],nonce()),'YA_CALIFICADO','Solo se califica una vez');
 $stats=Ratings::stats($store,$d1);
 check($stats['promedio']===4.0 && $stats['calificaciones']===1 && $stats['viajes']===1,'El reintento no suma dos veces y el promedio del chofer se actualiza');
 check($j['pago']==='pendiente','Se puede calificar con el pago todavía pendiente');
 $last=$store->redis->xrevrange($store->prefix.'viajes:eventos','+','-',1);
 check(reset($last)['accion']==='calificar','La calificación deja un evento');
 // Empty tags must round-trip as a list, not an object.
 $id2=$act($p,'crear','',$points)['id'];$act($d1,'reservar',$id2);$o=$act($d1,'ofertar',$id2,['importe'=>500])['oferta'];
 $act($p,'aceptar-oferta',$id2,['oferta_id'=>$o['id']]);$act($d1,'iniciar',$id2);$act($d1,'finalizar',$id2);
 $ratings->rate($p,$id2,['estrellas'=>2],nonce());
 check($journeys->get($p,$id2)['calificacion']['etiquetas']===[],'Sin etiquetas se devuelve una lista vacía');
 check(Ratings::stats($store,$d1)['promedio']===3.0,'El promedio combina varias calificaciones');
 echo "OK: $count verificaciones de chat y calificación".PHP_EOL;
} finally {
 $keys=[];$cursor='0';
 do { [$cursor,$batch]=$store->redis->scan($cursor,['match'=>$store->prefix.'*','count'=>500]); $keys=array_merge($keys,$batch); } while ($cursor!=='0');
 if ($keys) $store->redis->del($keys);
}
