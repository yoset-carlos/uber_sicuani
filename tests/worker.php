<?php
require dirname(__DIR__).'/src/bootstrap.php';
$store=new Uber\Store($argv[1],15);
try {(new Uber\Journeys($store))->action($argv[2],$argv[4]??'reservar',$argv[3],isset($argv[5])?json_decode($argv[5],true,32,JSON_THROW_ON_ERROR):[],bin2hex(random_bytes(16)));echo 'won';}
catch(Uber\ApiError){echo 'lost';}
