<?php
declare(strict_types=1);
namespace Uber;
use Predis\Client;
final class Store
{
    public readonly Client $redis;
    public readonly string $prefix;
    public function __construct(?string $prefix = null, ?int $database = null)
    {
        $this->prefix = $prefix ?? (getenv('REDIS_PREFIX') ?: 'uber:');
        $options = ['scheme'=>'tcp', 'host'=>getenv('REDIS_HOST') ?: '127.0.0.1', 'port'=>(int)(getenv('REDIS_PORT') ?: 6380), 'database'=>$database ?? (int)(getenv('REDIS_DATABASE') ?: 0), 'timeout'=>2, 'read_write_timeout'=>3];
        if (getenv('REDIS_PASSWORD')) $options['password'] = getenv('REDIS_PASSWORD');
        $this->redis = new Client($options);
    }
    public function run(string $script, array $args): mixed
    {
        return $this->redis->eval(file_get_contents(__DIR__ . '/lua/' . $script . '.lua'), 0, $this->prefix, ...array_map(static fn($v) => (string)$v, $args));
    }
    public function user(string $id): array { return $this->redis->hgetall($this->prefix . 'usuario:' . $id); }
    public static function safeUser(array $u): array { return array_intersect_key($u, array_flip(['id','nombre','usuario','rol','placa','color','marca','modelo','aprobado','disponible','practica'])); }
}
