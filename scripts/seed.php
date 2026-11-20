<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Store,Accounts};
if (getenv('APP_ENV') && getenv('APP_ENV')!=='local') {fwrite(STDERR,"El seed está limitado al entorno local.\n");exit(1);}
$store=new Store(); $accounts=new Accounts($store);
$path=dirname(__DIR__).'/storage/demo-credentials.json';
$existing=is_file($path)?json_decode(file_get_contents($path),true):null;
$password=$existing['password']??bin2hex(random_bytes(10));
$fixtures=[
 ['nombre'=>'Valeria Quispe','telefono'=>'987650001','usuario'=>'pasajero','rol'=>'pasajero'],
 ['nombre'=>'Luis Mamani','telefono'=>'987650002','usuario'=>'conductor1','rol'=>'conductor','placa'=>'V8S-241','color'=>'Blanco','marca'=>'Toyota','modelo'=>'Yaris'],
 ['nombre'=>'Diego Condori','telefono'=>'987650003','usuario'=>'conductor2','rol'=>'conductor','placa'=>'X4C-516','color'=>'Plata','marca'=>'Kia','modelo'=>'Rio'],
 ['nombre'=>'Laboratorio local','telefono'=>'987650004','usuario'=>'laboratorio','rol'=>'pasajero','practica'=>true]
];
foreach($fixtures as $f){if($store->redis->exists($store->prefix.'indice:usuario:'.$f['usuario']))continue;$accounts->create([...$f,'password'=>$password],$f['rol'],$f['practica']??false);}
file_put_contents($path,json_encode(['usuarios'=>array_column($fixtures,'usuario'),'password'=>$password],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE));
fwrite(STDOUT,"Cuentas demo preparadas: pasajero, conductor1, conductor2, laboratorio.\nContraseña local en storage/demo-credentials.json (archivo ignorado por Git).\nNo se cambiaron contraseñas de cuentas existentes.\n");
