<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
if(empty($argv[1])){fwrite(STDERR,"Uso: php scripts/verify-restore.php storage/backups/archivo.json\n");exit(1);}
$backup=json_decode(file_get_contents($argv[1]),true,512,JSON_THROW_ON_ERROR);
if(($backup['format']??null)!==1 || !is_array($backup['records']??null))throw new RuntimeException('Formato de copia inválido');
$prefix='sicuani-restore:'.bin2hex(random_bytes(12)).':';$store=new Uber\Store($prefix,15);$r=$store->redis;$count=0;$types=[];
foreach($backup['records'] as $item){
 if(!is_string($item['suffix']??null)||strlen($item['suffix'])>256)throw new RuntimeException('Nombre de clave inválido');
 $dump=base64_decode($item['dump'],true);if($dump===false)throw new RuntimeException('Copia dañada');
 $key=$prefix.$item['suffix'];
 $r->executeRaw(['RESTORE',$key,(string)max(0,(int)$item['ttl']),$dump]); // No REPLACE; never overwrites another key.
 if($r->dump($key)!==$dump)throw new RuntimeException('Verificación de contenido fallida');
 $type=(string)$r->type($key);$types[$type]=($types[$type]??0)+1;$count++;
}
echo "Restauración aislada verificada: $count claves en DB 15.\n";
echo 'Tipos: '.json_encode($types).PHP_EOL;
echo 'Namespace conservado: '.$prefix.PHP_EOL;
echo "La aplicación original no fue modificada.\n";
