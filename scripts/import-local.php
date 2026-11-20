<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
if (getenv('APP_ENV')!=='local' || (int)getenv('REDIS_PORT')!==6380) throw new RuntimeException('Importación exclusiva de la demo local WSL en puerto 6380.');
$backup=json_decode(file_get_contents($argv[1]??''),true,512,JSON_THROW_ON_ERROR);
$store=new Uber\Store();$r=$store->redis;
if(($backup['prefix']??null)!==$store->prefix || ($backup['format']??null)!==1)throw new RuntimeException('La copia no corresponde al prefijo del proyecto.');
$cursor='0';do{[$cursor,$keys]=$r->scan($cursor,['match'=>$store->prefix.'*','count'=>100]);if($keys)throw new RuntimeException('El destino ya contiene datos. No se sobrescribirá ninguna clave.');}while((string)$cursor!=='0');
$count=0;foreach($backup['records'] as $item){$dump=base64_decode($item['dump'],true);if($dump===false)throw new RuntimeException('Copia inválida');$r->executeRaw(['RESTORE',$store->prefix.$item['suffix'],(string)max(0,(int)$item['ttl']),$dump]);$count++;}
echo "$count claves importadas en Redis local WSL. El origen se conserva intacto.\n";
