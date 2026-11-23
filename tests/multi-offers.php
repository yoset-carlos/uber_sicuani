<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Store,Accounts,Journeys,ApiError};
$store=new Store('sicuani-multi-tests:'.bin2hex(random_bytes(8)).':',15);
$accounts=new Accounts($store);$journeys=new Journeys($store);$count=0;$sequence=0;
function check(bool $condition,string $name):void {global $count;if(!$condition)throw new RuntimeException('FAIL: '.$name);$count++;echo 'PASS: '.$name.PHP_EOL;}
function rejects(callable $action,string $kind,string $name):void {try{$action();}catch(ApiError $e){check($e->kind===$kind,$name);return;}throw new RuntimeException('FAIL: '.$name);}
function nonce():string {return bin2hex(random_bytes(16));}
$act=fn(string $uid,string $action,string $id,array $body=[],?string $request=null)=>$journeys->action($uid,$action,$id,$body,$request??nonce());
$points=['origen'=>['nombre'=>'Plaza de Sicuani','lat'=>-14.2714,'lng'=>-71.2292],'destino'=>['nombre'=>'Bombonera','lat'=>-14.28,'lng'=>-71.22]];
$scenario=function()use(&$sequence,$accounts,$store,$act,$points):array {
 $users=[];
 foreach(['pasajero','conductor','conductor','conductor'] as $role) {
  $n=++$sequence;
  $u=$accounts->create(['nombre'=>'Prueba '.$n,'usuario'=>'multi'.$n,'telefono'=>'98'.str_pad((string)$n,7,'0',STR_PAD_LEFT),'password'=>'Prueba-multi-123','placa'=>'MUL-'.$n,'color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],$role);
  if($role==='conductor')$store->redis->hset($store->prefix.'usuario:'.$u['id'],'disponible','1');
  $users[]=$u['id'];
 }
 $j=$act($users[0],'crear','',$points);
 return [$j['id'],...$users];
};
$edit=function(string $id,callable $change)use($store):void {
 $j=json_decode($store->redis->hget($store->prefix.'viaje:'.$id,'datos'),true,512,JSON_THROW_ON_ERROR);
 $change($j);$store->redis->hset($store->prefix.'viaje:'.$id,'datos',json_encode($j,JSON_THROW_ON_ERROR));
 $store->redis->zadd($store->prefix.'viajes:plazos',[$id=>time()-1]);
};
$free=fn($uid)=>!$store->redis->exists($store->prefix.'activo:'.$uid);
$cancel=['motivo'=>'cambio_de_planes','comentario'=>'Prueba'];
try {
 [$id,$p,$d1,$d2,$d3]=$scenario();
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 check($journeys->pending($d3)[0]['id']===$id,'Preparar dos precios no oculta la solicitud a un tercer chofer');
 $request=nonce();$a=$act($d1,'ofertar',$id,['importe'=>1000],$request)['oferta'];
 check($act($d1,'ofertar',$id,['importe'=>1000],$request)['oferta']['id']===$a['id'],'Reintentar envío no duplica la propuesta');
 $b=$act($d2,'ofertar',$id,['importe'=>1300])['oferta'];
 $j=$journeys->get($p,$id);
 check(count($j['ofertas'])===2 && !isset($j['conductor']),'Dos precios y vehículos llegan al pasajero sin asignar chofer');
 check(!isset($journeys->get($d1,$id)['ofertas']),'Los choferes no ven los precios de competidores');
 rejects(fn()=>$act($d2,'contraofertar',$id,['oferta_id'=>$a['id'],'importe'=>800]),'PERMISO','Un chofer no puede operar la propuesta de otro');
 $counter=$act($p,'contraofertar',$id,['oferta_id'=>$a['id'],'importe'=>900])['ofertas'];
 $mine=array_values(array_filter($counter,fn($o)=>$o['conductor']===$d1))[0];
 check($mine['vence']===$a['vence'] && count($counter)===2,'La contraoferta conserva el plazo y la propuesta competidora');
 rejects(fn()=>$act($p,'aceptar-oferta',$id,['oferta_id'=>$a['id']]),'ESTADO','No se acepta una versión anterior de la propuesta');
 $act($p,'rechazar-oferta',$id,['oferta_id'=>$b['id']]);
 check($free($d2) && count($journeys->get($p,$id)['ofertas'])===1 && !$free($d1),'Rechazar libera solo al autor de esa propuesta');
 $act($p,'cancelar',$id,$cancel);
 check($free($d1) && $free($p),'Cancelar la solicitud libera a todos sus participantes');

 [$id,$p,$d1,$d2]=$scenario();
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 $a=$act($d1,'ofertar',$id,['importe'=>1000])['oferta'];$b=$act($d2,'ofertar',$id,['importe'=>1200])['oferta'];
 $workers=[];
 foreach([$a,$b] as $offer) {
  $pipes=[];$proc=proc_open([PHP_BINARY,__DIR__.'/worker.php',$store->prefix,$p,$id,'aceptar-oferta',json_encode(['oferta_id'=>$offer['id']])],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
  $workers[]=[$proc,$pipes];
 }
 $results=[];
 foreach($workers as [$proc,$pipes]){$results[]=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($proc)!==0)throw new RuntimeException($err);}
 check(count(array_filter($results,fn($r)=>$r==='won'))===1,'Dos aceptaciones concurrentes confirman exactamente un chofer');
 $chosen=$journeys->get($p,$id);$loser=$chosen['conductor']===$d1?$d2:$d1;
 check($free($loser) && !$free($chosen['conductor']) && !$free($p),'La elección libera al perdedor y conserva al pasajero y ganador');
 $lost=$journeys->get($loser,$id);
 check($lost['estado']==='no_elegido' && !isset($lost['conductor_info']) && !isset($lost['precio']),'El perdedor recibe cierre sin datos de la propuesta ganadora');
 rejects(fn()=>$act($loser,'cancelar',$id,$cancel),'PERMISO','El perdedor no puede cancelar el viaje elegido');
 $act($p,'cancelar',$id,$cancel);

 [$id,$p,$d1,$d2]=$scenario();
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 $a=$act($d1,'ofertar',$id,['importe'=>1000])['oferta'];$b=$act($d2,'ofertar',$id,['importe'=>1200])['oferta'];
 $edit($id,function(&$j)use($d1){$j['participaciones'][$d1]['oferta']['vence']=time()-1;});
 check(count($journeys->get($p,$id)['ofertas'])===1 && $free($d1) && !$free($d2),'Vencer una propuesta conserva las demás');
 $edit($id,function(&$j){$j['busqueda_hasta']=time()-1;});
 check($journeys->get($p,$id)['estado']==='pendiente','Una oferta vigente mantiene la solicitud tras el plazo de búsqueda');
 $n=nonce();$accepted=$act($p,'aceptar-oferta',$id,['oferta_id'=>$b['id']],$n);
 check($accepted['conductor']===$d2 && $act($p,'aceptar-oferta',$id,['oferta_id'=>$b['id']],$n)['precio']===1200,'Aceptar una propuesta vigente y reintentar es idempotente');
 $edit($id,function(&$j){$j['inicio_hasta']=time()-1;});
 check($journeys->get($p,$id)['estado']==='cancelado' && $free($d2),'Sin inicio a tiempo se cancela y libera al chofer elegido');

 [$id,$p,$d1,$d2,$d3]=$scenario();
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 $edit($id,function(&$j)use($d1){$j['participaciones'][$d1]['reserva_hasta']=time()-1;$j['busqueda_hasta']=time()-1;});
 check($journeys->get($d1,$id)['estado']==='no_elegido' && $free($d1) && !$free($d2),'Cada preparación vence de manera independiente');
 rejects(fn()=>$act($d3,'reservar',$id),'ESTADO','No se reciben nuevos choferes tras el plazo de búsqueda');
 $b=$act($d2,'ofertar',$id,['importe'=>1200])['oferta'];
 check($b['importe']===1200,'Una preparación vigente permite enviar precio tras el plazo de búsqueda');
 $edit($id,function(&$j)use($d2){$j['participaciones'][$d2]['oferta']['vence']=time()-1;});
 check($journeys->get($p,$id)['estado']==='sin_conductor' && $free($p) && $free($d2),'Al vencer la última opción se cierra la búsqueda y libera a todos');

 [$id,$p,$d1,$d2]=$scenario();
 $act($d1,'reservar',$id);$act($d2,'reservar',$id);
 $act($d1,'ofertar',$id,['importe'=>1000]);$act($d2,'ofertar',$id,['importe'=>1200]);
 $act($d1,'cancelar',$id,$cancel);
 check(count($journeys->get($p,$id)['ofertas'])===1 && $free($d1) && !$free($d2),'Retirar propuesta no cancela la solicitud ni otras propuestas');
 $act($p,'cancelar',$id,$cancel);
 echo "\n$count verificaciones de propuestas múltiples aprobadas.\n";
} finally {
 $cursor=0;
 do {[$cursor,$keys]=$store->redis->scan($cursor,['match'=>$store->prefix.'*','count'=>100]);if($keys)$store->redis->del($keys);}while($cursor);
}
