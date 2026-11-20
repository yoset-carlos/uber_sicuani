<?php
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store($argv[1],15);
try {(new Uber\Journeys($store))->action($argv[2],'reservar',$argv[3],[],bin2hex(random_bytes(16)));echo 'won';}
catch(Uber\ApiError){echo 'lost';}
