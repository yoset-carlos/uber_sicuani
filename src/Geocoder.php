<?php
declare(strict_types=1);
namespace Uber;

final class Geocoder
{
    public function __construct(private readonly Store $store) {}

    public function search(array $input): array
    {
        $text=$input['texto']??null;
        if (!is_string($text) || mb_strlen(trim($text))<3 || mb_strlen($text)>120) {
            throw new ApiError('BUSQUEDA_INVALIDA','Escribe entre 3 y 120 caracteres.',422);
        }
        $text=trim($text);
        $endpoint=getenv('GEOCODER_SEARCH_URL')?:'https://photon.komoot.io/api';
        $result=['resultados'=>[],'estado'=>'no_disponible'];
        if (!str_starts_with($endpoint,'https://')) return $result;
        $key=$this->store->prefix.'geocodificacion:busqueda:'.hash('sha256',$endpoint.':'.mb_strtolower($text));
        $cached=$this->store->redis->get($key);
        if ($cached!==null) return json_decode($cached,true,32,JSON_THROW_ON_ERROR);
        $permit=$this->store->redis->executeRaw(['SET',$this->store->prefix.'geocodificacion:limite','1','NX','PX','1200']);
        if (!$permit) return ['resultados'=>[],'estado'=>'ocupado','reintentar_ms'=>1250];
        $url=$endpoint.'?'.http_build_query(['q'=>$text,'limit'=>5,'lat'=>-14.2714,'lon'=>-71.2292,'countrycode'=>'PE']);
        $curl=curl_init($url);
        curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>8,CURLOPT_IPRESOLVE=>CURL_IPRESOLVE_V4,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_USERAGENT=>'UberSicuani/1.0 academic-demo',CURLOPT_HTTPHEADER=>['Accept: application/json','Accept-Language: es']]);
        $raw=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
        if ($raw!==false && $status===200) {
            $json=json_decode($raw,true);
            if (is_array($json) && is_array($json['features']??null)) {
                $items=self::searchResults($json['features']);
                $result=['resultados'=>$items,'estado'=>$items?'encontrado':'sin_resultados'];
            }
        }
        $this->store->redis->setex($key,$result['estado']==='no_disponible'?30:604800,json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE));
        return $result;
    }

    public static function searchResults(array $features): array
    {
        $results=[];$seen=[];
        foreach ($features as $feature) {
            if (!is_array($feature)) continue;
            $p=$feature['properties']??null;$coordinates=$feature['geometry']['coordinates']??null;
            if (!is_array($p) || !is_array($coordinates) || ($feature['geometry']['type']??'')!=='Point') continue;
            [$lng,$lat]=array_pad($coordinates,2,null);
            if ((!is_int($lat) && !is_float($lat)) || (!is_int($lng) && !is_float($lng)) || !is_finite((float)$lat) || !is_finite((float)$lng) || abs($lat)>90 || abs($lng)>180) continue;
            $name=is_string($p['name']??null)?trim($p['name']):'';
            $street=is_string($p['street']??null)?trim($p['street']):'';
            $number=is_string($p['housenumber']??null)?trim($p['housenumber']):'';
            $address=trim($street.' '.$number);
            if ($address==='') $address=null;
            if ($name==='') $name=$address??'';
            if ($name==='') continue;
            $parts=[];
            foreach ([$address,$p['city']??$p['district']??null,$p['state']??null] as $part) {
                if (is_string($part) && trim($part)!=='' && mb_strtolower(trim($part))!==mb_strtolower($name) && !in_array(trim($part),$parts,true)) $parts[]=trim($part);
            }
            $description=implode(', ',$parts);
            $label=mb_substr($name.($description!==''?', '.$description:''),0,120);
            $id=mb_strtolower($label).':'.sprintf('%.5f,%.5f',$lat,$lng);
            if (isset($seen[$id])) continue;
            $seen[$id]=true;
            $results[]=['nombre'=>mb_substr($name,0,120),'direccion'=>mb_substr($description,0,240),'etiqueta'=>$label,'lat'=>$lat,'lng'=>$lng];
            if (count($results)===5) break;
        }
        return $results;
    }

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
