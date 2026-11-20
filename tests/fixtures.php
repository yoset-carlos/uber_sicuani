<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store();$accounts=new Uber\Accounts($store);
$password=bin2hex(random_bytes(12));$users=[];
foreach(['passenger','second','driver1','driver2','lab'] as $i=>$name){$role=str_starts_with($name,'driver')?'conductor':'pasajero';$users[$name]=$accounts->create(['nombre'=>'HTTP '.$name,'usuario'=>$name,'telefono'=>'98811100'.($i+1),'password'=>$password,'placa'=>'ABC-123','color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],$role,$name==='lab');if($role==='conductor')$store->redis->hset($store->prefix.'usuario:'.$users[$name]['id'],'disponible','1');$users[$name]=Uber\Store::safeUser($users[$name]);}
echo json_encode(['users'=>$users,'password'=>$password]);
