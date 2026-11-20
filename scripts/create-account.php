<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__).'/src/bootstrap.php';
// Provision accounts manually through PHP CLI. Never expose this script over HTTP.
try {
$data=json_decode(stream_get_contents(STDIN),true,32,JSON_THROW_ON_ERROR);
if (!is_array($data) || array_is_list($data)) throw new InvalidArgumentException('Envía un objeto JSON con los datos de la cuenta.');
foreach (['nombre','telefono','usuario','password','rol','placa','color','marca','modelo'] as $field) {
    if (array_key_exists($field,$data) && !is_string($data[$field])) throw new InvalidArgumentException('El campo '.$field.' debe ser texto.');
}
$role=$data['rol']??'conductor';
$account=(new Uber\Accounts(new Uber\Store()))->create($data,$role,($data['practica']??false)===true);
echo json_encode(Uber\Store::safeUser($account),JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT).PHP_EOL;
} catch (Uber\ApiError | InvalidArgumentException $e) {
    fwrite(STDERR,$e->getMessage().PHP_EOL); exit(1);
} catch (JsonException) {
    fwrite(STDERR,"No se creó la cuenta: el JSON no es válido.\n"); exit(1);
} catch (Throwable) {
    fwrite(STDERR,"No se creó la cuenta. Comprueba que Redis esté disponible y revisa la configuración privada.\n"); exit(1);
}
