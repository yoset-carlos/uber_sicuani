<?php
declare(strict_types=1);
$script=dirname(__DIR__).'/scripts/create-account.php';
foreach(['{','null','[]','{"nombre":42}'] as $body) {
    $process=proc_open([PHP_BINARY,$script],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
    fwrite($pipes[0],$body);fclose($pipes[0]);
    $output=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
    $exit=proc_close($process);
    if($exit!==1||$output!==''||$error===''||str_contains($error,'Stack trace')||str_contains($error,'Fatal error'))throw new RuntimeException('El CLI no rechazó los datos con un mensaje limpio.');
}
echo "4 verificaciones de validación del CLI aprobadas, sin crear cuentas.\n";
