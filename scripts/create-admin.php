<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') { http_response_code(404); exit; }
require dirname(__DIR__).'/src/bootstrap.php';
try {
    $data=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new InvalidArgumentException('Datos inválidos.');
    $account=(new Uber\Accounts(new Uber\Store()))->create($data,'administrador');
    echo 'Administrador creado: '.$account['usuario'].PHP_EOL;
} catch (Uber\ApiError | InvalidArgumentException $e) { fwrite(STDERR,$e->getMessage().PHP_EOL); exit(1); }
catch (Throwable) { fwrite(STDERR,"No se creó la cuenta. Comprueba Redis y la configuración.\n"); exit(1); }
