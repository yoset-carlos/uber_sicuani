<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store();$r=$store->redis;
$info=$r->info();
echo json_encode([
 'conexion'=>(string)$r->ping(),
 'version'=>$info['Server']['redis_version']??'desconocida',
 'aof'=>$info['Persistence']['aof_enabled']??null,
 'ultimo_rdb'=>$info['Persistence']['rdb_last_bgsave_status']??null,
 'memoria_bytes'=>$info['Memory']['used_memory']??null,
 'maxmemory_policy'=>$info['Memory']['maxmemory_policy']??null,
 'database'=>(int)(getenv('REDIS_DATABASE')?:0)
],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE).PHP_EOL;
