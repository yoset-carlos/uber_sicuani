<?php
declare(strict_types=1);
namespace Uber;
final class DriverReviews
{
    public function __construct(private readonly Store $store) {}
    public function list(): array {
        $cursor='0'; $out=[];
        do {
            [$cursor,$keys]=$this->store->redis->scan($cursor,['match'=>$this->store->prefix.'usuario:*','count'=>200]);
            foreach ($keys as $key) {
                if (!preg_match('/^'.preg_quote($this->store->prefix,'/').'usuario:([1-9]\d*)$/D',$key,$m)) continue;
                $u=$this->store->user($m[1]);
                if (($u['rol']??'')!=='conductor' || ($u['aprobado']??'0')==='1') continue;
                $out[]=array_intersect_key($u,array_flip(['id','nombre','usuario','telefono','placa','color','marca','modelo','revision_estado','revision_motivo']));
            }
        } while ((string)$cursor!=='0');
        usort($out,fn($a,$b)=>(int)$a['id']<=>(int)$b['id']);
        return $out;
    }
    public function decide(string $id,string $action,string $reason,string $actor): void {
        if (!preg_match('/^[1-9]\d*$/D',$id) || !in_array($action,['aprobar','rechazar'],true)) throw new ApiError('DATOS_INVALIDOS','Selecciona una solicitud válida.',422);
        $reason=trim($reason);
        if ($action==='rechazar' && (mb_strlen($reason)<3 || mb_strlen($reason)>500)) throw new ApiError('MOTIVO_INVALIDO','Escribe un motivo de 3 a 500 caracteres.',422);
        $result=$this->store->run('driver-review',[$id,$action,$action==='rechazar'?$reason:'',$actor,(string)time()]);
        if ($result==='NOT_FOUND') throw new ApiError('NO_ENCONTRADO','No se encontró la solicitud de chofer.',404);
        if ($result==='CONFLICT') throw new ApiError('ESTADO','La solicitud ya fue resuelta. Actualiza la lista.',409);
    }
}
