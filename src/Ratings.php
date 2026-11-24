<?php
declare(strict_types=1);
namespace Uber;
final class Ratings
{
    public const TAGS=['Puntual','Amable','Auto limpio','Buena conducción','Llegó tarde','Manejo brusco','Auto sucio','Otro'];
    public function __construct(private readonly Store $store) {}
    public function rate(string $uid,string $id,array $input,string $nonce): void
    {
        if (!preg_match('/^[a-zA-Z0-9_-]{16,80}$/D',$nonce)) throw new ApiError('PETICION_INVALIDA','Falta un identificador válido de petición.',422);
        $stars=$input['estrellas']??null;
        $tags=$input['etiquetas']??[];
        $comment=trim((string)($input['comentario']??''));
        if (!is_int($stars) || $stars<1 || $stars>5) throw new ApiError('CALIFICACION_INVALIDA','Elige de 1 a 5 estrellas.',422);
        if (!is_array($tags) || !array_is_list($tags) || count($tags)>count(self::TAGS) || array_diff($tags,self::TAGS) || count(array_unique($tags))!==count($tags)) throw new ApiError('CALIFICACION_INVALIDA','Elige etiquetas de la lista.',422);
        if (mb_strlen($comment)>500) throw new ApiError('CALIFICACION_INVALIDA','El comentario puede tener hasta 500 caracteres.',422);
        $body=json_encode(['estrellas'=>$stars,'etiquetas'=>array_values($tags),'comentario'=>$comment],JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
        $result=$this->store->run('rating',[$uid,$id,$body,$nonce]);
        if ($result[0]==='ok') return;
        [$status,$message]=match($result[1]) {
            'PERMISO'=>[403,'Solo el pasajero de este viaje puede calificarlo.'],
            'NO_EXISTE'=>[404,'No encontramos ese viaje.'],
            'YA_CALIFICADO'=>[409,'Ya calificaste este viaje.'],
            'PETICION_REUTILIZADA'=>[409,'La solicitud fue utilizada con otros datos. Inténtalo de nuevo.'],
            default=>[409,'Solo puedes calificar un viaje finalizado.']
        };
        throw new ApiError($result[1],$message,$status);
    }
    /** @return array{promedio: ?float, calificaciones: int, viajes: int} */
    public static function stats(Store $store,string $driver): array
    {
        $s=$store->redis->hmget($store->prefix.'calificaciones:'.$driver,['suma','cantidad']);
        $count=(int)($s[1]??0);
        return ['promedio'=>$count?round((int)$s[0]/$count,1):null,'calificaciones'=>$count,'viajes'=>(int)($store->redis->zscore($store->prefix.'ranking:conductores',$driver)??0)];
    }
}
