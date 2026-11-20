<?php
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
if (is_file(dirname(__DIR__) . '/.env')) {
    foreach (file(dirname(__DIR__) . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$name, $value] = explode('=', $line, 2);
        if (getenv(trim($name)) === false) putenv(trim($name) . '=' . trim($value));
    }
}
date_default_timezone_set('America/Lima');
