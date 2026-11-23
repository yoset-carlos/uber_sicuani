<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Store,Accounts,Journeys,Practice,Geocoder,ApiError};
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH) ?: '/';
if (in_array($path,['/como-funciona','/como-funciona/'],true)) { header('Cache-Control: no-cache'); require dirname(__DIR__).'/views/guide.php'; exit; }
if (!str_starts_with($path,'/api')) { header('Cache-Control: no-cache'); require dirname(__DIR__).'/views/app.php'; exit; }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
ini_set('session.use_strict_mode','1');
session_name('sicuani_session');
session_save_path(dirname(__DIR__).'/storage');
session_set_cookie_params(['httponly'=>true,'secure'=>getenv('SESSION_SECURE')==='1','samesite'=>'Lax','path'=>'/']);
session_start();
$_SESSION['csrf']??=bin2hex(random_bytes(32));
$requestId=bin2hex(random_bytes(8));
header('X-Request-Id: '.$requestId);
function respond(mixed $data,int $status=200): never { http_response_code($status); echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE); exit; }
try {
    $method=$_SERVER['REQUEST_METHOD'];
    if (!in_array($method,['GET','POST'],true)) throw new ApiError('METODO','Método no permitido.',405);
    $csrf=$_SESSION['csrf']; $uid=$_SESSION['uid']??null;
    if ($method==='POST') {
        if (!hash_equals($csrf,$_SERVER['HTTP_X_CSRF_TOKEN']??'')) throw new ApiError('CSRF','La sesión cambió. Actualiza la página e inténtalo otra vez.',403);
        if ((int)($_SERVER['CONTENT_LENGTH']??0)>16384) throw new ApiError('CUERPO_GRANDE','La solicitud es demasiado grande.',413);
        $body=json_decode(file_get_contents('php://input'),true,32,JSON_THROW_ON_ERROR);
        if (!is_array($body)) throw new ApiError('JSON_INVALIDO','Envía un objeto JSON válido.',422);
        foreach (['usuario','password','nombre','telefono','rol','placa','color','marca','modelo','peticion_id','motivo','comentario','accion'] as $field) {
            if (array_key_exists($field,$body) && !is_string($body[$field])) throw new ApiError('DATOS_INVALIDOS','El campo '.$field.' debe ser texto.',422);
        }
        if (array_key_exists('oferta_id',$body) && !is_string($body['oferta_id']) && !is_int($body['oferta_id'])) throw new ApiError('DATOS_INVALIDOS','El identificador de oferta no es válido.',422);
    } else $body=[];
    if ($method==='GET' && $path==='/api/sesion' && !$uid) {
        session_write_close(); respond(['ok'=>true,'datos'=>['usuario'=>null,'csrf'=>$csrf,'servidor'=>time(),'teselas'=>getenv('TILE_URL')?:'https://tile.openstreetmap.org/{z}/{x}/{y}.png']]);
    }
    $store=new Store(); $accounts=new Accounts($store); $journeys=new Journeys($store);
    // Atomically limited; never log passwords, CSRF tokens, or connection credentials.
    if ($method==='POST') {
        $ip=$_SERVER['REMOTE_ADDR']??'local'; $bucket=in_array($path,['/api/login','/api/registro'],true)?'auth':'acciones';
        $limit=$bucket==='auth'?30:120;
        $hits=$store->redis->eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,$store->prefix.'limite:'.$bucket.':'.hash('sha256',$uid??$ip));
        if ($hits>$limit) {header('Retry-After: 60'); throw new ApiError('LIMITE','Hay demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.',429);}
    }
    if ($method==='POST' && in_array($path,['/api/login','/api/registro'],true)) {
        if ($path==='/api/login') {
            $u=$accounts->login((string)($body['usuario']??''),(string)($body['password']??''));
        } else {
            $role=$body['rol']??'pasajero';
            if (!in_array($role,['pasajero','conductor'],true)) throw new ApiError('ROL_INVALIDO','Selecciona Pasajero o Chofer para crear tu cuenta.',422);
            $u=$accounts->create($body,$role,false,$role==='pasajero');
            if ($role==='conductor') {
                session_regenerate_id(true);
                unset($_SESSION['uid']);
                $_SESSION['csrf']=bin2hex(random_bytes(32));
                $newCsrf=$_SESSION['csrf'];session_write_close();
                respond(['ok'=>true,'datos'=>['usuario'=>null,'cuenta'=>Store::safeUser($u),'csrf'=>$newCsrf,'pendiente_aprobacion'=>true]]);
            }
        }
        session_regenerate_id(true); $_SESSION['uid']=$u['id']; $_SESSION['csrf']=bin2hex(random_bytes(32));
        $newCsrf=$_SESSION['csrf']; session_write_close();
        respond(['ok'=>true,'datos'=>['usuario'=>Store::safeUser($u),'csrf'=>$newCsrf]]);
    }
    if (!$uid) throw new ApiError('SESION','Inicia sesión para continuar.',401);
    $u=$store->user($uid);
    if (!$u || ($u['rol']==='conductor' && $u['aprobado']!=='1')) throw new ApiError('SESION','Tu sesión ya no está disponible. Vuelve a iniciar sesión.',401);
    if ($method==='POST' && $path==='/api/logout') {
        $_SESSION=[]; session_destroy(); setcookie(session_name(),'', ['expires'=>time()-3600,'path'=>'/','httponly'=>true,'samesite'=>'Lax','secure'=>getenv('SESSION_SECURE')==='1']);
        respond(['ok'=>true,'datos'=>null]);
    }
    session_write_close(); // Do not serialize polling/action requests behind a PHP session lock.
    if (str_starts_with($path,'/api/admin/')) {
        if ($u['rol']!=='administrador') throw new ApiError('PERMISO','Solo el administrador puede revisar solicitudes.',403);
        $reviews=new Uber\DriverReviews($store);
        if ($method==='GET' && $path==='/api/admin/solicitudes') respond(['ok'=>true,'datos'=>$reviews->list()]);
        if ($method==='POST' && preg_match('#^/api/admin/solicitudes/([1-9]\d*)/(aprobar|rechazar)$#D',$path,$m)) {
            $reviews->decide($m[1],$m[2],(string)($body['motivo']??''),$uid);
            respond(['ok'=>true,'datos'=>['guardado'=>true]]);
        }
        throw new ApiError('RUTA','No encontramos esa operación.',404);
    }
    if ($u['rol']==='administrador' && !in_array($path,['/api/sesion','/api/estado'],true)) throw new ApiError('PERMISO','Esta operación no está disponible para administradores.',403);
    $data=match(true) {
        $method==='GET' && $path==='/api/sesion'=>['usuario'=>Store::safeUser($u),'csrf'=>$csrf,'servidor'=>time(),'teselas'=>getenv('TILE_URL')?:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        $method==='GET' && $path==='/api/viajes/activo'=>$journeys->active($uid),
        $method==='GET' && $path==='/api/viajes/pendientes'=>$journeys->pending($uid),
        $method==='GET' && $path==='/api/viajes/historial'=>$journeys->history($uid),
        $method==='GET' && $path==='/api/estado'=>snapshot($journeys,$u),
        $method==='POST' && $path==='/api/disponibilidad'=>availability($store,$u,$body),
        $method==='POST' && $path==='/api/mapa/direccion'=>$u['rol']==='pasajero'?(new Geocoder($store))->reverse($body):throw new ApiError('PERMISO','Solo pasajeros pueden seleccionar puntos de recogida y destino.',403),
        $method==='POST' && $path==='/api/mapa/buscar'=>$u['rol']==='pasajero'?(new Geocoder($store))->search($body):throw new ApiError('PERMISO','Solo pasajeros pueden buscar direcciones.',403),
        $method==='POST' && $path==='/api/viajes'=>$journeys->action($uid,'crear','',$body,(string)($body['peticion_id']??'')),
        $method==='GET' && preg_match('#^/api/viajes/([1-9]\d*)$#D',$path,$m)===1=>$journeys->get($uid,$m[1]),
        $method==='POST' && preg_match('#^/api/viajes/([1-9]\d*)/([a-z-]+)$#D',$path,$m)===1=>$journeys->action($uid,$m[2],$m[1],$body,(string)($body['peticion_id']??'')),
        $method==='GET' && $path==='/api/practica'=>(new Practice($store))->execute($u,'consultar'),
        $method==='POST' && $path==='/api/practica'=>(new Practice($store))->execute($u,(string)($body['accion']??''),$body),
        default=>throw new ApiError('RUTA','No encontramos esa operación.',404)
    };
    respond(['ok'=>true,'datos'=>$data]);
} catch (ApiError $e) { respond(['ok'=>false,'error'=>['codigo'=>$e->kind,'mensaje'=>$e->getMessage(),'peticion'=>$requestId]],$e->status); }
catch (JsonException) { respond(['ok'=>false,'error'=>['codigo'=>'JSON_INVALIDO','mensaje'=>'El formato de la solicitud no es válido.','peticion'=>$requestId]],422); }
catch (Throwable $e) {
    if (session_status()===PHP_SESSION_ACTIVE) session_write_close();
    error_log('Uber request '.$requestId.' '.$e::class); // Details deliberately omit credentials and payloads.
    respond(['ok'=>false,'error'=>['codigo'=>'SERVICIO_NO_DISPONIBLE','mensaje'=>'El servicio no está disponible. Inténtalo nuevamente.','peticion'=>$requestId]],503);
}
function snapshot(Journeys $journeys,array $u): array {
    if ($u['rol']==='administrador') return ['usuario'=>Store::safeUser($u),'viaje'=>null,'pendientes'=>[],'servidor'=>time(),'finalizados'=>0];
    $active=$journeys->active($u['id']);
    return ['usuario'=>Store::safeUser($journeys->store->user($u['id'])),'viaje'=>$active,'pendientes'=>$u['rol']==='conductor' && !$active?$journeys->pending($u['id']):[],'servidor'=>time(),'finalizados'=>(int)($journeys->store->redis->zscore($journeys->store->prefix.'ranking:conductores',$u['id'])??0)];
}
function availability(Store $store,array $u,array $body): array {
    if ($u['rol']!=='conductor') throw new ApiError('PERMISO','Solo conductores pueden cambiar su disponibilidad.',403);
    if (!is_bool($body['disponible']??null)) throw new ApiError('DISPONIBILIDAD_INVALIDA','Selecciona Disponible o No disponible.',422);
    if ($store->run('availability',[$u['id'],$body['disponible']?'1':'0'])!==1) throw new ApiError('PERMISO','La cuenta no está autorizada para conducir.',403);
    return Store::safeUser($store->user($u['id']));
}
