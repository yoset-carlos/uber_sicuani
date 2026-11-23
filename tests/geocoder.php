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
$feature=['type'=>'Feature','properties'=>['name'=>'Catedral de Sicuani','street'=>'Plaza de Armas','city'=>'Sicuani','state'=>'Cusco'],'geometry'=>['type'=>'Point','coordinates'=>[-71.226317,-14.2734769]]];
$results=Geocoder::searchResults([$feature,$feature,['geometry'=>['type'=>'Point','coordinates'=>[181,0]],'properties'=>['name'=>'Inválido']]]);
if (count($results)!==1 || $results[0]['lat']!==-14.2734769 || $results[0]['lng']!==-71.226317 || $results[0]['etiqueta']!=='Catedral de Sicuani, Plaza de Armas, Sicuani, Cusco') throw new RuntimeException('Sugerencias incorrectas');
if (Geocoder::searchResults([['properties'=>[],'geometry'=>['type'=>'Point','coordinates'=>[0,0]]]])!==[]) throw new RuntimeException('Se inventó una dirección');
foreach ([null,[],42,'ab',str_repeat('a',121)] as $text) {
 try {$geocoder->search(['texto'=>$text]);throw new RuntimeException('Búsqueda inválida aceptada');}
 catch(ApiError $e) {if ($e->status!==422) throw $e;}
}
$store=new Store('sicuani-search-tests:'.bin2hex(random_bytes(8)).':',15);
$geocoder=new Geocoder($store);
$endpoint=getenv('GEOCODER_SEARCH_URL')?:'https://photon.komoot.io/api';
$cacheKey=$store->prefix.'geocodificacion:busqueda:'.hash('sha256',$endpoint.':plaza sicuani');
$limitKey=$store->prefix.'geocodificacion:limite';
try {
 $cached=['resultados'=>$results,'estado'=>'encontrado'];
 $store->redis->setex($cacheKey,60,json_encode($cached));
 $store->redis->setex($limitKey,60,'1');
 if ($geocoder->search(['texto'=>' Plaza Sicuani '])!==$cached) throw new RuntimeException('No se reutilizó caché');
 if ($geocoder->search(['texto'=>'otra búsqueda'])['estado']!=='ocupado') throw new RuntimeException('No se respetó el límite compartido');
} finally {$store->redis->del([$cacheKey,$limitKey]);}
echo "18 verificaciones de geocodificación aprobadas, sin consultas externas.\n";
