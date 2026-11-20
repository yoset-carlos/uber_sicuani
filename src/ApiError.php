<?php
declare(strict_types=1);
namespace Uber;
final class ApiError extends \RuntimeException
{
    public function __construct(public readonly string $kind, string $message, public readonly int $status = 409) { parent::__construct($message); }
}
