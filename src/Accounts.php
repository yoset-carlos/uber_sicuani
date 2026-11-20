<?php
declare(strict_types=1);
namespace Uber;
final class Accounts
{
    public function __construct(private readonly Store $store) {}
    public function create(array $data, string $role='pasajero', bool $practice=false, bool $approved=true): array
    {
        $name=trim((string)($data['nombre'] ?? ''));
        $username=mb_strtolower(trim((string)($data['usuario'] ?? '')));
        $phone=preg_replace('/[\s()+-]/', '', (string)($data['telefono'] ?? ''));
        if (str_starts_with($phone, '51') && strlen($phone)===11) $phone=substr($phone,2);
        $password=(string)($data['password'] ?? '');
        if (mb_strlen($name)<2 || mb_strlen($name)>80 || !preg_match('/^[a-z0-9_.-]{3,32}$/D',$username) || !preg_match('/^9\d{8}$/D',$phone) || strlen($password)<8 || strlen($password)>72) {
            throw new ApiError('DATOS_INVALIDOS','Revisa nombre, usuario (3 a 32 caracteres), celular peruano y contraseña (8 a 72 caracteres).',422);
        }
        if (!in_array($role,['pasajero','conductor','administrador'],true)) throw new \InvalidArgumentException('Rol inválido');
        $u=['nombre'=>$name,'usuario'=>$username,'telefono'=>$phone,'password'=>password_hash($password,PASSWORD_DEFAULT),'rol'=>$role,'aprobado'=>$approved?'1':'0','disponible'=>'0','practica'=>$practice?'1':'0'];
        if ($role==='conductor') foreach (['placa','color','marca','modelo'] as $field) {
            $value=trim((string)($data[$field]??''));
            if ($value==='' || mb_strlen($value)>60) throw new ApiError('VEHICULO_INVALIDO','Completa placa, color, marca y modelo.',422);
            $u[$field]=$value;
        }
        $result=$this->store->run('account',[json_encode($u,JSON_THROW_ON_ERROR)]);
        if ($result[0]!=='ok') {
            $message=match ($result[1] ?? '') {
                'USUARIO_DUPLICADO' => 'Ese nombre de usuario ya está registrado. Elige otro o inicia sesión.',
                'TELEFONO_DUPLICADO' => 'Ese número de celular ya está registrado. Usa otro o inicia sesión con tu cuenta existente.',
                default => throw new \RuntimeException('No se pudo completar el registro.'),
            };
            throw new ApiError('DUPLICADO',$message,422);
        }
        return $this->store->user($result[1]);
    }
    public function login(string $username,string $password): array
    {
        $id=$this->store->redis->get($this->store->prefix.'indice:usuario:'.mb_strtolower(trim($username)));
        $u=$id ? $this->store->user($id) : [];
        if (!password_verify($password,$u['password']??'$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi') || !$u) {
            throw new ApiError('CREDENCIALES','No pudimos iniciar sesión. Revisa tu usuario y contraseña.',401);
        }
        if ($u['rol']==='conductor' && $u['aprobado']!=='1') {
            if (($u['revision_estado']??'')==='rechazado') throw new ApiError('RECHAZADO','Tu solicitud de chofer fue rechazada. Motivo: '.($u['revision_motivo']??''),403);
            throw new ApiError('PENDIENTE_APROBACION','Tu cuenta de chofer está registrada y pendiente de aprobación.',403);
        }
        return $u;
    }
}
