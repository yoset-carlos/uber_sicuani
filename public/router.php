<?php
declare(strict_types=1);
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH) ?: '/';
// The built-in server must never serve source/config files outside public.
if (PHP_SAPI==='cli-server' && $path!=='/' && !str_starts_with($path,'/api')) {
    $candidate=realpath(__DIR__.$path);
    if ($candidate && str_starts_with($candidate,__DIR__.DIRECTORY_SEPARATOR) && is_file($candidate) && pathinfo($candidate,PATHINFO_EXTENSION)!=='php') return false;
}
require __DIR__.'/index.php';
