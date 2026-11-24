<?php
declare(strict_types=1);
namespace Uber;
final class Chat
{
    public function __construct(private readonly Store $store) {}
    private function journey(string $uid,string $id): array
    {
        $raw=$this->store->redis->hget($this->store->prefix.'viaje:'.$id,'datos');
        if ($raw===null) throw new ApiError('NO_EXISTE','No encontramos ese viaje.',404);
        $j=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
        // Competing drivers that were not chosen never see the conversation.
        if ($uid!==$j['pasajero'] && $uid!==($j['conductor']??null)) throw new ApiError('PERMISO','Este chat no pertenece a tu cuenta.',403);
        return $j;
    }
    public function read(string $uid,string $id,string $since=''): array
    {
        if ($since!=='' && !preg_match('/^\d{1,20}-\d{1,20}$/D',$since)) throw new ApiError('DATOS_INVALIDOS','El punto de lectura del chat no es válido.',422);
        $j=$this->journey($uid,$id);
        // "(" exclusive ranges need Redis 6.2; the next sequence number works on older servers too.
        $start='-';
        if ($since!=='') { [$ms,$seq]=explode('-',$since); $start=$ms.'-'.((int)$seq+1); }
        $entries=$this->store->redis->xrange($this->store->prefix.'chat:'.$id,$start,'+',200) ?: [];
        $messages=[];
        foreach ($entries as $mid=>$m) $messages[]=['id'=>(string)$mid,'autor'=>$m['autor'],'rol'=>$m['rol'],'texto'=>$m['texto'],'fecha'=>(int)$m['fecha']];
        return ['mensajes'=>$messages,'abierto'=>in_array($j['estado'],['confirmado','en_curso'],true)];
    }
    public function send(string $uid,string $id,array $input,string $nonce): array
    {
        if (!preg_match('/^[a-zA-Z0-9_-]{16,80}$/D',$nonce)) throw new ApiError('PETICION_INVALIDA','Falta un identificador válido de petición.',422);
        $text=trim(preg_replace('/\s+/u',' ',(string)($input['texto']??'')) ?? '');
        if ($text==='' || mb_strlen($text)>500) throw new ApiError('MENSAJE_INVALIDO','Escribe un mensaje de hasta 500 caracteres.',422);
        $result=$this->store->run('chat',[$uid,$id,$text,$nonce]);
        if ($result[0]!=='ok') {
            [$status,$message]=match($result[1]) {
                'PERMISO'=>[403,'Este chat no pertenece a tu cuenta.'],
                'NO_EXISTE'=>[404,'No encontramos ese viaje.'],
                'CHAT_CERRADO'=>[409,'El chat se cerró porque el viaje ya no está activo.'],
                'PETICION_REUTILIZADA'=>[409,'La solicitud fue utilizada con otros datos. Inténtalo de nuevo.'],
                default=>[409,'No se pudo enviar el mensaje. Actualiza e inténtalo de nuevo.']
            };
            throw new ApiError($result[1],$message,$status);
        }
        return ['id'=>$result[1]];
    }
}
