<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store();$r=$store->redis;$cursor='0';$records=[];
do {[$cursor,$keys]=$r->scan($cursor,['match'=>$store->prefix.'*','count'=>100]);foreach($keys as $key){$ttl=$r->pttl($key);$dump=$r->dump($key);if($dump!==null)$records[]=['suffix'=>substr($key,strlen($store->prefix)),'ttl'=>max(0,$ttl),'dump'=>base64_encode($dump)];}}while((string)$cursor!=='0');
$dir=dirname(__DIR__).'/storage/backups';if(!is_dir($dir))mkdir($dir,0700,true);
$path=$dir.'/redis-'.date('Ymd-His').'-'.bin2hex(random_bytes(3)).'.json';
file_put_contents($path,json_encode(['format'=>1,'created'=>time(),'prefix'=>$store->prefix,'records'=>$records],JSON_THROW_ON_ERROR));
echo 'Backup local: '.$path.PHP_EOL.'Claves copiadas: '.count($records).PHP_EOL;
echo "Para una copia consistente con actividad real, detener nuevas escrituras mientras se ejecuta este respaldo manual.\n";
