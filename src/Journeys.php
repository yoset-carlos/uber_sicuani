<?php
declare(strict_types=1);
namespace Uber;
final class Journeys
{
    public function __construct(public readonly Store $store) {}
    private function execute(string $uid,string $action,string $id,array $body=[],string $nonce=''): string
    {
        $multi=$action==='crear' || ($id!=='' && ($this->raw($id)['version']??1)===2);
        $result=$this->store->run($multi?'journey-multi':'journey',[$uid,$action,$id,json_encode($body,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE),$nonce]);
        if ($result[0]==='ok') return $result[1];
        [$status,$message]=match($result[1]) {
            'PERMISO'=>[403,'No tienes permiso para realizar esta acción.'],
            'NO_EXISTE'=>[404,'No encontramos ese viaje.'],
            'OCUPADO'=>[409,'Ya tienes un viaje activo o no estás disponible. Actualiza el estado.'],
            'EXCLUIDO'=>[409,'Esta solicitud ya no está disponible para ti. Elige otra.'],
            'PAGO_REGISTRADO'=>[409,'El pago ya fue registrado y no puede cambiarse.'],
            'PETICION_REUTILIZADA'=>[409,'La solicitud fue utilizada con otros datos. Actualiza e inténtalo de nuevo.'],
            default=>[409,'El viaje cambió de estado o venció el plazo. Consulta el estado actualizado.']
        };
        throw new ApiError($result[1],$message,$status);
    }
    public function settle(string $uid): void
    {
        // Each page reconciles due work on demand, with no background process.
        $due=$this->store->redis->zrangebyscore($this->store->prefix.'viajes:plazos','-inf',(string)time(),['limit'=>[0,100]]);
        foreach ($due as $id) $this->execute($uid,'sincronizar',(string)$id);
    }
    public function active(string $uid): ?array
    {
        $this->settle($uid);
        $id=$this->store->redis->get($this->store->prefix.'activo:'.$uid);
        return $id ? $this->get($uid,$id) : null;
    }
    public function get(string $uid,string $id): array
    {
        $this->execute($uid,'sincronizar',$id);
        $j=$this->raw($id);
        if ($uid!==$j['pasajero'] && $uid!==($j['conductor']??null) && !isset($j['participaciones'][$uid])) throw new ApiError('PERMISO','Este viaje no pertenece a tu cuenta.',403);
        return $this->present($j,$uid);
    }
    private function raw(string $id): array {
        $raw=$this->store->redis->hget($this->store->prefix.'viaje:'.$id,'datos');
        if ($raw===null) throw new ApiError('NO_EXISTE','No encontramos ese viaje.',404);
        return json_decode($raw,true,512,JSON_THROW_ON_ERROR);
    }
    private function present(array $j,string $uid): array
    {
        if (($j['version']??1)===2) {
            $entries=$j['participaciones'];
            $j['ofertas']=[];
            if ($uid===$j['pasajero']) {
                foreach ($entries as $driver=>$entry) {
                    if ($entry['estado']!=='ofertado') continue;
                    $offer=$entry['oferta'];
                    $offer['conductor_info']=array_intersect_key($this->store->user((string)$driver),array_flip(['id','nombre','marca','modelo','color','placa']));
                    $j['ofertas'][]=$offer;
                }
                usort($j['ofertas'],static fn($a,$b)=>(int)$a['conductor']<=>(int)$b['conductor']);
            } elseif (($j['conductor']??null)!==$uid) {
                $entry=$entries[$uid];
                // A competing driver can see only their own proposal and the public route.
                $j=array_intersect_key($j,array_flip(['version','id','pasajero','estado','origen','destino','creado','busqueda_hasta','pago']));
                $j['estado']=in_array($entry['estado'],['reservado','ofertado'],true)?$entry['estado']:'no_elegido';
                $j['motivo_propuesta']=$entry['estado'];
                $j['conductor']=$uid;
                $j['reserva_hasta']=$entry['reserva_hasta'];
                if (isset($entry['oferta'])) $j['oferta']=$entry['oferta'];
            }
            unset($j['participaciones']);
        }
        unset($j['excluidos']);
        $j['incidencias']=array_values($j['incidencias']??[]);
        $j['pasajero_info']=array_intersect_key($this->store->user($j['pasajero']),array_flip(['id','nombre']));
        // Before a price is proposed, vehicle identity remains private to the driver.
        if (isset($j['conductor'], $j['oferta']) && $j['estado']!=='reservado' && $j['estado']!=='no_elegido') $j['conductor_info']=Store::safeUser($this->store->user($j['conductor']));
        return $j;
    }
    public function pending(string $uid): array
    {
        $u=$this->store->user($uid);
        if (($u['rol']??'')!=='conductor') throw new ApiError('PERMISO','Solo conductores pueden consultar solicitudes.',403);
        $this->settle($uid);
        if ($u['disponible']!=='1' || $this->store->redis->exists($this->store->prefix.'activo:'.$uid)) return [];
        $out=[];
        foreach ($this->store->redis->smembers($this->store->prefix.'viajes:pendientes') as $id) {
            $j=$this->raw($id);
            if (!isset($j['excluidos'][$uid]) && $j['estado']==='pendiente') $out[] = array_intersect_key($j,array_flip(['version','id','origen','destino','creado','busqueda_hasta','estado']));
        }
        usort($out,static fn($a,$b)=>$a['creado']<=>$b['creado']); return $out;
    }
    public function history(string $uid): array
    {
        $this->settle($uid); $out=[];
        foreach ($this->store->redis->smembers($this->store->prefix.'historial:'.$uid) as $id) $out[]=$this->present($this->raw($id),$uid);
        usort($out,static fn($a,$b)=>(int)$b['id']<=>(int)$a['id']); return $out;
    }
    public function action(string $uid,string $action,string $id,array $input,string $nonce): array
    {
        if (!preg_match('/^[a-zA-Z0-9_-]{16,80}$/D',$nonce)) throw new ApiError('PETICION_INVALIDA','Falta un identificador válido de petición.',422);
        $this->settle($uid);
        $body=[];
        if ($action==='crear') {
            foreach (['origen','destino'] as $point) {
                $v=$input[$point]??[];
                if (!is_array($v) || !is_string($v['nombre']??null)) throw new ApiError('PUNTO_INVALIDO','Cada punto necesita coordenadas y un nombre.',422);
                $label=trim($v['nombre']);
                $lat=filter_var($v['lat']??null,FILTER_VALIDATE_FLOAT); $lng=filter_var($v['lng']??null,FILTER_VALIDATE_FLOAT);
                if ($lat===false || $lng===false || !is_finite($lat) || !is_finite($lng) || abs($lat)>90 || abs($lng)>180 || mb_strlen($label)<2 || mb_strlen($label)>120) throw new ApiError('PUNTO_INVALIDO','Marca ambos puntos en el mapa y escribe sus nombres o referencias.',422);
                $body[$point]=['lat'=>$lat,'lng'=>$lng,'nombre'=>$label];
            }
            if ($body['origen']['lat']===$body['destino']['lat'] && $body['origen']['lng']===$body['destino']['lng']) throw new ApiError('PUNTOS_IGUALES','El origen y el destino deben ser diferentes.',422);
        } elseif (in_array($action,['ofertar','contraofertar'],true)) {
            $cents=$input['importe']??null;
            if (!is_int($cents) || $cents<100 || $cents>100000) throw new ApiError('PRECIO_INVALIDO','Ingresa un precio entre S/ 1.00 y S/ 1,000.00.',422);
            $body=['importe'=>$cents];
            if ($action==='contraofertar') {
                if (!preg_match('/^[1-9]\d*$/D',(string)($input['oferta_id']??''))) throw new ApiError('OFERTA_INVALIDA','Actualiza la oferta antes de responder.',422);
                $body['oferta_id']=(string)$input['oferta_id'];
            }
        } elseif (in_array($action,['aceptar-oferta','rechazar-oferta'],true)) {
            if (!preg_match('/^[1-9]\d*$/D',(string)($input['oferta_id']??''))) throw new ApiError('OFERTA_INVALIDA','Actualiza la oferta antes de responder.',422);
            $body=['oferta_id'=>(string)$input['oferta_id']];
        } elseif (in_array($action,['cancelar','registrar-incidencia'],true)) {
            $reason=(string)($input['motivo']??''); $comment=trim((string)($input['comentario']??''));
            $reasons=$action==='cancelar'?['cambio_de_planes','error_de_puntos','no_disponible','otro']:['punto_acordado','problema_durante_viaje','otro'];
            if (!in_array($reason,$reasons,true) || mb_strlen($comment)>500 || (($reason==='otro' || $action==='registrar-incidencia') && mb_strlen($comment)<3)) throw new ApiError('MOTIVO_INVALIDO','Selecciona un motivo y completa el comentario cuando corresponda (máximo 500 caracteres).',422);
            $body=['motivo'=>$reason,'comentario'=>$comment];
        } elseif ($action==='registrar-pago') {
            if (!in_array($input['metodo']??'', ['efectivo','yape'],true)) throw new ApiError('PAGO_INVALIDO','Selecciona Efectivo o Yape recibido.',422);
            $body=['metodo'=>$input['metodo']];
        } elseif (!in_array($action,['reservar','iniciar','finalizar'],true)) throw new ApiError('ACCION_INVALIDA','La acción no está disponible.',404);
        $jid=$this->execute($uid,$action,$id,$body,$nonce);
        return $this->get($uid,$jid);
    }
}
