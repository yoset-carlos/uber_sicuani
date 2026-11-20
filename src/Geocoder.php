<?php
declare(strict_types=1);
namespace Uber;

final class Geocoder
{
    public function __construct(private readonly Store $store) {}

    public function reverse(array $input): array
    {
        foreach (['lat','lng'] as $field) {
            $value=$input[$field]??null;
            if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || abs($value)>($field==='lat'?90:180)) {
                throw new ApiError('PUNTO_INVALIDO','Selecciona un punto válido en el mapa.',422);
            }
        }
        $endpoint=getenv('GEOCODER_URL')?:'https://photon.komoot.io/reverse';
        if (!str_starts_with($endpoint,'https://')) return ['nombre'=>null,'estado'=>'no_disponible'];
        $key=$this->store->prefix.'geocodificacion:'.hash('sha256',$endpoint.':'.sprintf('%.5f,%.5f',$input['lat'],$input['lng']));
        $cached=$this->store->redis->get($key);
        if ($cached!==null) return json_decode($cached,true,32,JSON_THROW_ON_ERROR);
        // Shared by all sessions. No background work or periodic upstream lookups.
        $permit=$this->store->redis->executeRaw(['SET',$this->store->prefix.'geocodificacion:limite','1','NX','PX','1200']);
        if (!$permit) return ['nombre'=>null,'estado'=>'ocupado','reintentar_ms'=>1250];
        $url=$endpoint.'?'.http_build_query(['lat'=>$input['lat'],'lon'=>$input['lng'],'limit'=>1,'radius'=>0.5]).'&layer=house&layer=street';
        $curl=curl_init($url);
        curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>8,CURLOPT_IPRESOLVE=>CURL_IPRESOLVE_V4,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_USERAGENT=>'UberSicuani/1.0 academic-demo',CURLOPT_HTTPHEADER=>['Accept: application/json','Accept-Language: es']]);
        $raw=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);$error=curl_errno($curl);curl_close($curl);
        if ($raw===false || $status!==200) error_log('Geocoder unavailable: HTTP '.$status.' cURL '.$error);
        $result=['nombre'=>null,'estado'=>'no_disponible'];
        if ($raw!==false && $status===200) {
            $json=json_decode($raw,true);
            $name=self::label($json['features'][0]['properties']??[]);
            $result=['nombre'=>$name,'estado'=>$name?'encontrado':'sin_direccion'];
        }
        $this->store->redis->setex($key,$result['nombre']?604800:30,json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE));
        return $result;
    }

    public static function label(array $properties): ?string
    {
        $street=$properties['street']??(($properties['type']??'')==='street'?($properties['name']??''): '');
        if (!is_string($street) || trim($street)==='') return null;
        $number=is_string($properties['housenumber']??null)?$properties['housenumber']:'';
        $city=$properties['city']??$properties['district']??'';
        $parts=[trim($street.' '.$number)];
        if (is_string($city) && trim($city)!=='' && mb_strtolower(trim($city))!==mb_strtolower(trim($street))) $parts[]=trim($city);
        return mb_substr(implode(', ',$parts),0,120);
    }
}
