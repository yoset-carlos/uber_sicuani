<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/src/bootstrap.php';
$username=mb_strtolower(trim($argv[1]??''));
if(!preg_match('/^[a-z0-9_.-]{3,32}$/D',$username)){fwrite(STDERR,"Uso: php scripts/approve-driver.php USUARIO\n");exit(1);}
try {
    $store=new Uber\Store();
    $id=$store->redis->get($store->prefix.'indice:usuario:'.$username);
    if (!$id) { fwrite(STDERR,"No existe ese usuario.\n"); exit(1); }
    (new Uber\DriverReviews($store))->decide((string)$id,'aprobar','','consola');
    echo "Cuenta de chofer aprobada. Ya puede iniciar sesión y activar Disponible.\n";
}catch(Uber\ApiError $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}catch(Throwable){fwrite(STDERR,"No se pudo aprobar la cuenta. Comprueba la conexión con Redis.\n");exit(1);}
