<?php
declare(strict_types=1);
namespace Uber\Console;

use Composer\Script\Event;
use Symfony\Component\Console\Formatter\OutputFormatter;
use Uber\{Accounts,Store,ApiError};

final class CreateDriver
{
    public static function run(Event $event): int
    {
        require_once dirname(__DIR__).'/bootstrap.php';
        $io=$event->getIO();
        if (!$io->isInteractive()) {
            throw new \RuntimeException('Este asistente necesita una terminal interactiva. Ejecuta composer conductor sin --no-interaction.',1);
        }
        try {
            $io->write('Crear y aprobar conductor de Uber Sicuani');
            $io->write('La cuenta se guardará en Redis y usará el inicio de sesión habitual.');
            $data=['rol'=>'conductor'];
            foreach (['nombre'=>'Nombre completo','telefono'=>'Celular peruano','usuario'=>'Usuario','placa'=>'Placa del vehículo','color'=>'Color','marca'=>'Marca','modelo'=>'Modelo'] as $field=>$label) {
                $value=$io->ask($label.': ');
                if ($value===null || $value===false) throw new \InvalidArgumentException('No se recibió entrada de teclado. Ejecuta composer conductor directamente en una terminal.');
                $data[$field]=trim((string)$value);
                if ($data[$field]==='') throw new \InvalidArgumentException('Completa el campo: '.$label);
            }
            $password=$io->askAndHideAnswer('Contraseña (8 a 72 caracteres ASCII): ');
            $confirmation=$io->askAndHideAnswer('Repite la contraseña: ');
            if (!is_string($password) || !is_string($confirmation)) throw new \InvalidArgumentException('No se recibió la contraseña. No se creó la cuenta.');
            if (strlen($password)<8 || strlen($password)>72) throw new \InvalidArgumentException('La contraseña debe ocupar entre 8 y 72 bytes. No se creó la cuenta.');
            if (!hash_equals($password,$confirmation)) throw new \InvalidArgumentException('Las contraseñas no coinciden. No se creó la cuenta.');
            $io->write('');
            $io->write(OutputFormatter::escape('Conductor: '.$data['nombre']));
            $io->write(OutputFormatter::escape('Usuario: '.$data['usuario'].' | Celular: '.$data['telefono']));
            $io->write(OutputFormatter::escape('Vehículo: '.$data['marca'].' '.$data['modelo'].' | '.$data['color'].' | '.$data['placa']));
            $decision=$io->ask('¿Crear y aprobar esta cuenta? Escribe SI para continuar: ','NO');
            if (strtoupper(trim((string)$decision))!=='SI') {
                $io->write('Operación cancelada. No se creó ninguna cuenta.');
                return 0;
            }
            $data['password']=$password;
            $user=(new Accounts(new Store()))->create($data,'conductor');
            $io->write(OutputFormatter::escape('Conductor creado y aprobado. Usuario: '.$user['usuario']));
            $io->write('Inicia sesión con ese usuario y contraseña; después activa Disponible.');
            return 0;
        } catch (ApiError | \InvalidArgumentException $e) {
            throw new \RuntimeException($e->getMessage(),1);
        } catch (\Throwable) {
            throw new \RuntimeException('No se creó la cuenta. Comprueba Redis y que la terminal permita introducir una contraseña oculta.',1);
        } finally {
            unset($password,$confirmation,$data['password']);
        }
    }
}
