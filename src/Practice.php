<?php
declare(strict_types=1);
namespace Uber;
final class Practice
{
    public function __construct(private readonly Store $store) {}
    public function execute(array $user,string $action,array $input=[]): mixed
    {
        if (getenv('PRACTICE_ENABLED')!=='1' || ($user['practica']??'0')!=='1') throw new ApiError('PERMISO','Esta página está reservada a la cuenta autorizada para la práctica.',403);
        $r=$this->store->redis; $stream=$this->store->prefix.'practica:eventos'; $group='laboratorio';
        if (!in_array($action,['consultar','crear-grupo','agregar','leer','pendientes','confirmar'],true)) throw new ApiError('ACCION_INVALIDA','Selecciona una acción del laboratorio.',422);
        try { return match($action) {
            'consultar'=>$r->executeRaw(['XRANGE',$stream,'-','+','COUNT','50']),
            'crear-grupo'=>$this->createGroup($stream,$group),
            'agregar'=>$r->executeRaw(['XADD',$stream,'*','tipo','demostracion','autor',$user['id'],'fecha',(string)time()]),
            'leer'=>$r->xreadgroup($group,'cuenta-'.$user['id'],10,null,false,$stream,'>'),
            'pendientes'=>$r->xpending($stream,$group),
            'confirmar'=>$this->ack($stream,$group,$input['ids']??[])
        }; } catch (\Predis\Response\ServerException $e) {
            if (str_contains($e->getMessage(),'NOGROUP')) throw new ApiError('GRUPO_PENDIENTE','Primero crea el grupo de práctica y luego vuelve a leer los eventos.',409);
            throw $e;
        }
    }
    private function createGroup(string $stream,string $group): string
    {
        try {$this->store->redis->executeRaw(['XGROUP','CREATE',$stream,$group,'0','MKSTREAM']);}
        catch (\Predis\Response\ServerException $e) {if (!str_contains($e->getMessage(),'BUSYGROUP')) throw $e;}
        return 'Grupo disponible';
    }
    private function ack(string $stream,string $group,mixed $ids): int
    {
        if (!is_array($ids) || count($ids)<1 || count($ids)>20) throw new ApiError('IDS_INVALIDOS','Selecciona entre 1 y 20 IDs de eventos pendientes.',422);
        foreach ($ids as $id) if (!is_string($id) || !preg_match('/^\d+-\d+$/D',$id)) throw new ApiError('IDS_INVALIDOS','Usa IDs de mensajes como 123456789-0.',422);
        return $this->store->redis->xack($stream,$group,...$ids);
    }
}
