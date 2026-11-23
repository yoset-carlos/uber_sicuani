# Uber Sicuani

Aplicación académica de viajes simulados, implementada con PHP 8.3, Redis, HTML, CSS y JavaScript. Interfaz en español y soles, adaptable a móviles y escritorio. No hay cobros reales.

## Arranque local en Windows

El entorno de esta máquina tiene PHP y Composer disponibles, Ubuntu en WSL2 y Redis 8 instalado. El puerto usado es **8081** porque Windows restringe el 8080.

```powershell
composer install
powershell -File scripts/start.ps1
```

Abrir <http://127.0.0.1:8081>. El script inicia Redis del proyecto en WSL2 por el puerto **6380** y PHP por 8081. Sus datos quedan en `/var/lib/redis-sicuani`; no utiliza ni modifica el Redis de Windows que ya ocupa 6379. Si Redis ya está iniciado, usar directamente `composer serve`. Para preparar cuentas ficticias, ejecutar `php scripts/seed.php` en otra terminal una vez iniciado Redis.

En otra instalación, copiar `.env.example` a `.env` antes del arranque y configurar la conexión privada de Redis. El servidor web debe servir **únicamente `public/`**, nunca la raíz del proyecto.

### Cuentas de demostración

`php scripts/seed.php` crea `pasajero`, `conductor1`, `conductor2` y `laboratorio`. Genera una contraseña aleatoria local en `storage/demo-credentials.json`, fuera de la carpeta pública y excluida de Git. No cambia contraseñas de cuentas ya existentes.

Para probar pasajero y conductor simultáneamente en un navegador: usar `127.0.0.1:8081` para uno y `localhost:8081` para el otro, o perfiles/navegadores separados. Dos pestañas del mismo origen comparten sesión.

La cuenta `laboratorio` solo puede usar las prácticas si `PRACTICE_ENABLED=1`. En la configuración de ejemplo está deshabilitado; en esta demo local está habilitado. Las cuentas comunes no acceden a esas acciones.

### Recursos de la interfaz

En celular (hasta 800 px), el mapa ocupa el fondo y los controles viven en un panel inferior con tres alturas: compacto (22 %), medio (58 %) y ampliado (90 %, dejando espacio para la navegación). El tirador se puede arrastrar o manejar con flechas, Inicio/Fin y los botones Subir/Bajar. Los formularios amplían el panel al recibir foco; la posición, el desplazamiento y los campos en edición se conservan cuando llegan nuevas propuestas. La interfaz utiliza azul petróleo y mantiene mapa y panel lateral en escritorio. La altura se adapta al área visible y al teclado mediante `visualViewport` cuando está disponible.

Leaflet, Inter y los iconos se sirven localmente. Las teselas del mapa necesitan internet. Los recursos preparados están en `public/assets/`; para regenerarlos:

```powershell
npm.cmd ci
npm.cmd run assets
```

Las dependencias de Node se usan únicamente para preparar recursos y ejecutar verificaciones; no se necesita un servidor Node para utilizar la aplicación.

## Funcionalidades

- Acceso unificado y registro web con elección Pasajero/Chofer. Los pasajeros acceden al registrarse; los choferes quedan pendientes de aprobación manual.
- Mapa centrado en Sicuani; puntos manuales con nombres/referencias; GPS opcional para el origen. También puede enfocarse el mapa, desplazarse con el teclado y presionar Enter para fijar el centro como punto seleccionado.
- Solicitudes con propuestas de varios choferes: cada uno prepara y envía su precio; el pasajero compara precio y vehículo, negocia una propuesta o elige con quién viajar.
- Un solo viaje activo por usuario. Cada chofer participa en una solicitud a la vez mientras prepara o espera respuesta; su participación no bloquea a los demás choferes.
- Preparación de 1 minuto por chofer, propuesta de 5 minutos, búsqueda original de 10 minutos y cancelación tras 30 minutos confirmado sin inicio. Cada preparación/propuesta obtenida a tiempo conserva su propio plazo.
- Exclusión del conductor tras rechazo o vencimiento. Reapertura solamente mientras quede tiempo de búsqueda.
- Cancelación con motivo antes del inicio; incidencias con motivo/comentario durante el viaje.
- Finalización con pago pendiente; registro posterior de Efectivo/Yape simulado; historial persistente y ranking de conductores por viajes finalizados.
- Laboratorio privado: XGROUP, XREADGROUP, XPENDING, XACK sobre un Stream de práctica separado.

La línea discontinua une los dos puntos como referencia: **no representa una ruta calculada por calles**. No hay seguimiento GPS continuo, estimaciones de llegada, categorías comerciales ni pagos con tarjeta.

Al marcar o mover un punto, PHP consulta Photon y completa la dirección de la calle próxima. Las coordenadas se conservan internamente, sin mostrarse en los inputs. Seleccionar el campo o su botón activa el punto; otros clics y el arrastre del marcador lo cambian sin reajustar el zoom. Una nueva selección reemplaza la dirección anterior; escribir manualmente durante la búsqueda conserva ese texto y descarta la respuesta tardía. Los borradores antiguos con coordenadas como texto se convierten al abrir la pantalla.

Al escribir al menos tres caracteres en recogida o destino, aparecen hasta cinco sugerencias de Photon, con prioridad alrededor de Sicuani y búsqueda en Perú. Se puede elegir con toque, clic o flechas y Enter; Escape cierra la lista. Elegir un lugar guarda sus coordenadas y centra el marcador; se mantiene la edición manual de referencias y la selección por mapa o GPS. La cobertura depende de los lugares registrados en OpenStreetMap.

`GEOCODER_URL` configura la geocodificación inversa y `GEOCODER_SEARCH_URL` la búsqueda por texto (por defecto, `https://photon.komoot.io/api`). El endpoint autenticado `POST /api/mapa/buscar` recibe `{texto}` y devuelve `{estado, resultados}`; cada resultado incluye `nombre`, `direccion`, `etiqueta`, `lat` y `lng`. PHP aplica caché de 7 días y un intervalo global mínimo de 1,2 segundos compartido entre búsqueda e inversa; las búsquedas esperan 400 ms sin escribir y solo reintentan si siguen vigentes. El servicio demo admite uso razonable sin garantizar disponibilidad: [documentación de Photon](https://github.com/komoot/photon). Si no hay conexión o dirección disponible, se permite marcar el punto y escribir una referencia. Elegir un proveedor con capacidad adecuada antes de ampliar el uso.

## Arquitectura y consistencia

- `public/`: entrada HTTP, estilos, JavaScript y recursos locales.
- `src/`: cuentas, consultas, validación, laboratorio y scripts Lua de operaciones atómicas.
- `views/`: estructura HTML; `scripts/`: herramientas exclusivamente de consola; `tests/`: verificaciones aisladas.
- Configuración privada en `.env`; sesiones PHP, credenciales demo y copias en `storage/`, fuera de la raíz pública.

Redis usa Strings para contadores, índices únicos e idempotencia; Hashes para usuarios, viajes y ofertas; Sets para solicitudes, disponibilidad e historiales; Sorted Sets para plazos y ranking; Streams para eventos. Los registros permanentes no tienen TTL. Los límites de peticiones sí caducan.

El backend usa la hora de Redis para las transiciones y valida estado, actor y vencimiento en Lua. La creación y los cambios reciben un `peticion_id`: reintentos iguales no duplican efectos; reutilizar el ID con datos diferentes produce conflicto. Los eventos se escriben en la misma ejecución atómica que la transición. Pago, oferta y viaje conservan estados separados.

Los vencimientos se procesan al consultar o actuar, hasta 100 viajes vencidos por consulta para limitar el trabajo de cada petición. No hay cron, workers ni WebSockets. El navegador consulta cada 5 segundos sin superponer consultas, pausa en pestañas ocultas y recupera el estado al reconectar. Redis es la autoridad sobre los plazos; el contador visual es orientativo.

Las contraseñas se guardan con hash PHP. La API valida sesión, rol, pertenencia y CSRF, limita las peticiones y evita exponer datos privados de cuentas. Redis se conecta exclusivamente desde PHP. El servidor local no sustituye el servidor HTTPS de producción.

### Registrarse como pasajero o chofer

En la pantalla de acceso, pulsar **Crear una cuenta** y elegir **Tipo de cuenta**. Pasajero solicita nombre, celular, usuario y contraseña. Chofer solicita además placa, color, marca y modelo. Cambiar de tipo conserva los datos escritos; los campos del vehículo solo son obligatorios para choferes.

El pasajero entra al terminar. El chofer queda pendiente. Para crear la primera cuenta administradora, con Redis iniciado ejecuta una vez:

```powershell
powershell -NoProfile -File scripts/crear-administrador.ps1
```

Introduce nombre, celular y usuario nuevos, y una contraseña que se solicitará de forma oculta. Inicia sesión en la aplicación con esa cuenta; en **Solicitudes** puedes revisar, aprobar o rechazar choferes con un motivo. Las solicitudes rechazadas se pueden aprobar posteriormente. El chofer ve el motivo al intentar iniciar sesión y, una vez aprobado, puede entrar y activar Disponible. El formulario público no crea administradores.

Como alternativa local se conserva `php scripts/approve-driver.php USUARIO_DEL_CHOFER`, que utiliza la misma lógica de aprobación. Las decisiones guardan responsable y fecha en Redis.

### Crear un conductor manualmente (alternativa)

Con Redis iniciado, abrir PowerShell en la carpeta del proyecto y ejecutar:

```powershell
composer conductor
```

El asistente usa las preguntas nativas de Composer y pide nombre, celular, usuario, placa, color, marca y modelo. La contraseña y su confirmación se introducen de forma oculta. Después de revisar el resumen, escribir `SI` crea y aprueba manualmente la cuenta en Redis. Este flujo alternativo permite al responsable preparar una cuenta directamente. Se conserva también el registro web descrito arriba, cuyos choferes requieren aprobación posterior.

Ejecutar el comando directamente en una terminal interactiva, sin redirigir su entrada ni usar `--no-interaction`. La versión anterior lanzaba PowerShell desde Composer y podía recibir una entrada cerrada; esa dependencia se eliminó. El script PowerShell se conserva como alternativa directa: `./scripts/crear-conductor.ps1`.

Usuario y teléfono deben ser únicos, incluso frente a pasajeros. Si ya existen, se informa el conflicto y no se modifica ni se convierte automáticamente la cuenta existente.

Enviar JSON a `php scripts/create-account.php` por stdin con `nombre`, `telefono`, `usuario`, `password`, `rol: "conductor"`, `placa`, `color`, `marca` y `modelo`. Usar una contraseña de 8 a 72 caracteres. No poner contraseñas en argumentos de consola ni publicar este script. Para revocar aprobación, actualizar el campo `aprobado` del Hash del usuario a `0` desde una conexión privada de Redis.

## API JSON

Todas las rutas usan `/api`. Las consultas son GET y las acciones POST. Primero consultar `/sesion` para obtener el token CSRF y enviarlo como `X-CSRF-Token` en cada POST. La autenticación regenera la sesión y el token.

| Ruta | Operación |
| --- | --- |
| GET `/sesion` | Cuenta actual, CSRF, hora y URL de teselas |
| POST `/registro`, `/login`, `/logout` | Registrar pasajero/chofer, acceder y salir |
| GET `/estado` | Consulta consolidada de cuenta, viaje activo, solicitudes y total finalizado |
| POST `/disponibilidad` | `{ "disponible": true/false }`, solo conductor |
| POST `/mapa/direccion` | `{ "lat": numero, "lng": numero }`, solo pasajero, devuelve dirección aproximada o ausencia de resultado |
| GET `/viajes/activo`, `/viajes/pendientes`, `/viajes/historial` | Consultas autorizadas |
| GET `/viajes/{id}` | Estado de un viaje propio |
| POST `/viajes` | Crear con `origen`, `destino` y `peticion_id` |
| POST `/viajes/{id}/{accion}` | `reservar`, `ofertar`, `aceptar-oferta`, `rechazar-oferta`, `cancelar`, `iniciar`, `finalizar`, `registrar-pago`, `registrar-incidencia` |
| GET/POST `/practica` | Laboratorio privado autorizado |

Los puntos llevan `nombre`, `lat`, `lng`. `ofertar` recibe `importe` entero en céntimos, entre 100 y 100000; aceptar/rechazar recibe `oferta_id`; pago recibe `metodo: "efectivo"/"yape"`; cancelación/incidencia recibe `motivo` y `comentario`. Todas las acciones sobre viajes requieren `peticion_id` único (16–80 caracteres alfanuméricos, guion o guion bajo).

Las nuevas solicitudes usan `version: 2`. `reservar` inicia una preparación individual sin retirar la solicitud para otros choferes. El pasajero recibe `ofertas` (lista con ID, autor, chofer, importe, vencimiento y `conductor_info`) mientras el viaje permanece `pendiente`. `contraofertar`, `aceptar-oferta` y `rechazar-oferta` operan únicamente sobre el `oferta_id` indicado. La aceptación confirma un solo chofer en una operación atómica y libera a los demás. Rechazar o vencer una propuesta no afecta a las otras; cancelar como chofer antes de la confirmación retira solo su participación. El chofer recibe una vista personal `reservado`/`ofertado` y únicamente su oferta, o `no_elegido` cuando termina su participación. Los viajes anteriores sin versión conservan el flujo original para no interrumpirlos.

Registro recibe `rol: "pasajero"/"conductor"` (valor por defecto pasajero para compatibilidad) y, en conductor, `placa`, `color`, `marca`, `modelo`. El registro de chofer devuelve `usuario: null`, `cuenta` sin secretos y `pendiente_aprobacion: true`; no inicia sesión. El servidor decide la aprobación y los permisos de laboratorio, sin aceptar privilegios enviados por el cliente. Un inicio de sesión con credenciales válidas pero sin aprobación responde403 con `PENDIENTE_APROBACION`.

Respuestas: `{ "ok": true, "datos": ... }` o `{ "ok": false, "error": { "codigo": "...", "mensaje": "...", "peticion": "..." } }`. Errores: 401 sesión, 403 permisos/CSRF, 404 recurso/acción, 409 conflicto, 422 validación, 429 límite y 503 indisponibilidad. Ante 409 o reconexión consultar nuevamente el estado.

## Pruebas y recuperación

```powershell
composer test
npm.cmd run test:http
npm.cmd run test:outage
npm.cmd run check
npm.cmd run test:sheet
npm.cmd run test:autocomplete
node tests/load.mjs
php scripts/backup.php
php scripts/verify-restore.php storage/backups/ARCHIVO.json
php tests/account-cli.php
powershell -NoProfile -File tests/driver-wizard.ps1
```

- Servicios: concurrencia con dos procesos PHP reales; unicidad, permisos, transiciones, idempotencia, ranking, límites temporales y laboratorio contra Redis real. `composer test` también verifica propuestas múltiples, elección concurrente, privacidad entre choferes y vencimientos independientes, además de conservar la cobertura del flujo heredado.
- HTTP: servidor temporal en 8082; cookies, CSRF, roles, tipos inválidos y recorrido completo.
- Indisponibilidad: servidor temporal en 8084 apuntado a un puerto sin Redis; verifica respuesta503 sin secretos y acceso recuperado al volver a la conexión correcta. No detiene el servicio real.
- Carga: servidor temporal en 8083, tres sesiones por 15 minutos y polling cada 5 segundos. Guarda latencias, errores y número de peticiones en `storage/load-report.json`. Es una simulación de clientes; no reemplaza la prueba con tres teléfonos físicos.
- Pruebas y restauraciones usan DB 15 y prefijos aleatorios propios, separados de la aplicación. **No ejecutan FLUSHDB ni limpiezas globales.** Conservan sus fixtures para inspección, excepto la prueba de propuestas múltiples, que elimina únicamente las claves de su propio prefijo al terminar.
- La copia manual usa SCAN/DUMP y la restauración verifica cada contenido en claves nuevas, sin REPLACE. Para obtener una copia consistente, detener temporalmente todas las peticiones de la aplicación: incluso una consulta puede aplicar un vencimiento. Usar una versión compatible de Redis para restaurar.
- AOF está habilitado en el Redis local de WSL2. Las copias y credenciales locales contienen datos privados y no deben servirse ni añadirse a Git.

## Demo en teléfonos y despliegue

La demo está enlazada a loopback de forma predeterminada. Para la prueba física, ejecutar PHP o configurar Laragon en una red privada de confianza y acceder desde tres dispositivos con perfiles/sesiones independientes. Si se usa HTTP de red local y GPS no está disponible, seleccionar el origen manualmente. Usar datos ficticios.

El hosting objetivo sigue pendiente de validar. Antes de publicar: comprobar Redis privado desde PHP, Lua/EVAL, Streams, límites de memoria y política de expulsión, persistencia, cobertura del respaldo y restauración; configurar HTTPS, `SESSION_SECURE=1`, `APP_ENV=production`, credenciales privadas, raíz `public/` y acceso limitado al grupo de prueba. Deshabilitar el laboratorio si no se va a usar. No subir `node_modules`, fixtures de prueba, `.env` local, sesiones, credenciales demo ni copias.

Las teselas públicas OSM están previstas solo para la demo de bajo uso. Mantener atribución visible, Referer y caché normal; no precargar ni descargar teselas en masa. `TILE_URL` permite cambiar de proveedor antes de ampliar el uso.

Seguimiento: [Desarrollo — Uber Sicuani](https://app.notion.com/p/41e36035b0e281dcb4d9f9e7a787b0a6), con Pendiente, En proceso y Terminado. Análisis vigente: [Uber Sicuani — Análisis funcional](https://app.notion.com/p/41b36035b0e281ca8c05cd0b30f5bf35).

Referencias: [Leaflet 1.x](https://leafletjs.com/examples-v1.html), [política de teselas OSM](https://operations.osmfoundation.org/policies/tiles/) y [ubicación de Sicuani, INEI](https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1018/Libro.pdf). Licencias de Leaflet, Heroicons e Inter incluidas junto a sus recursos en `public/assets/vendor/`.
