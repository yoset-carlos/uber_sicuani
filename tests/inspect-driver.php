<?php
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store();
$id=$store->redis->get($store->prefix.'indice:usuario:'.$argv[1]);
$user=$id?$store->user($id):[];
echo json_encode(['usuario'=>$user['usuario']??null,'nombre'=>$user['nombre']??null,'rol'=>$user['rol']??null,'aprobado'=>$user['aprobado']??null,'disponible'=>$user['disponible']??null,'password_ok'=>isset($user['password'])&&password_verify('Prueba-Conductor-123',$user['password']),'contador'=>(int)($store->redis->get($store->prefix.'contador:usuarios')??0)],JSON_UNESCAPED_UNICODE);
