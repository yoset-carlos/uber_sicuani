<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
use Uber\{Geocoder,Store,ApiError};
$cases=[
 [['type'=>'street','name'=>'Jirón Juan de la Cruz Montaño','city'=>'Sicuani'],'Jirón Juan de la Cruz Montaño, Sicuani'],
 [['type'=>'house','street'=>'Avenida Centenario','housenumber'=>'123','city'=>'Sicuani'],'Avenida Centenario 123, Sicuani'],
 [['type'=>'city','name'=>'Sicuani'],null],
 [[],null],
 [['type'=>'street','name'=>'Calle de ejemplo','district'=>'Sicuani'],'Calle de ejemplo, Sicuani']
];
foreach($cases as [$input,$expected]) {if(Geocoder::label($input)!==$expected)throw new RuntimeException('Formato de dirección incorrecto');}
$geocoder=new Geocoder(new Store('sicuani-geocoder-tests:'.bin2hex(random_bytes(8)).':',15));
foreach([['lat'=>91,'lng'=>0],['lat'=>0,'lng'=>181],['lat'=>['no'],'lng'=>0],['lat'=>0,'lng'=>null]] as $input){
 try{$geocoder->reverse($input);throw new RuntimeException('Punto inválido aceptado');}
 catch(ApiError $e){if($e->status!==422)throw $e;}
}
echo "9 verificaciones de direcciones y validación aprobadas, sin consultas externas.\n";
