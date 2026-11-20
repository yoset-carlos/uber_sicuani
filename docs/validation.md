# Validación de la primera implementación

Fecha: 19 de noviembre de 2026, America/Lima.

## Entorno observado

- Windows con PHP 8.3.30 y Predis 3.7.1; Ubuntu en WSL2 con Redis 8.0.5.
- Redis del proyecto se conecta desde PHP por loopback en 6380, con directorio exclusivo `/var/lib/redis-sicuani`. AOF habilitado en `config/redis.local.conf`; memoria con política `noeviction`.
- Aplicación local en el puerto 8081. Windows rechazó el enlace al puerto 8080, por lo que no se usa como valor predeterminado.
- Interfaz HTML/CSS/JavaScript con recursos locales de Leaflet, Inter y Heroicons. Las teselas OSM requieren conexión externa.

## Evidencia ejecutada

- `composer test`: pruebas de servicio contra Redis real, con dos procesos PHP compitiendo por reservar una solicitud. Verifica unicidad, permisos, exclusión, pagos, historial, ranking y plazos de 1/5/10/30 minutos. Los vencimientos se prueban ajustando fechas en fixtures aislados, sin esperar esos plazos completos.
- `npm.cmd run test:http`: pruebas de sesión/cookies/CSRF, validación, permisos, reserva simultánea, recorrido completo y laboratorio a través de HTTP.
- Una comprobación de versión detectó que Windows ya tenía Redis 5 en 6379. Se aisló la instancia WSL2 en 6380 y se copiaron las 29 claves ficticias de la demo sin sobrescribir ni eliminar el origen. Las 37 pruebas de servicio y 30 HTTP se repitieron correctamente contra Redis 8.0.5 en WSL2.
- Restauración manual: después del aislamiento se restauraron y compararon 29 claves copiadas desde Redis 8, en claves nuevas de DB 15, sin REPLACE ni borrados. Se verificaron los cinco tipos de datos utilizados.
- Resultado actualizado: 42 verificaciones de servicios, 30 HTTP y 3 de indisponibilidad/recuperación aprobadas, incluidas trazabilidad de expiraciones y reservas que conservan su plazo propio al finalizar la búsqueda.
- La prueba de indisponibilidad usa un servidor HTTP temporal apuntado a un puerto sin Redis. Devuelve503 con un error recuperable sin exponer secretos y permite acceder al recuperar la conexión correcta. No se detuvo el Redis usado por la aplicación.
- Navegador real: acceso de pasajero y conductor; marcado manual de origen/destino; solicitud; disponibilidad; reserva; propuesta de S/ 11.40; aceptación; recuperación de estado al recargar; inicio; incidencia con formulario; finalización; Yape simulado e historial.
- Vista móvil 390×844 y escritorio 1440×900. Se comprobó ausencia de desbordamiento horizontal en escritorio. Consola sin errores en el recorrido observado.

Las pruebas usan DB 15 y prefijos aleatorios separados. La revisión automática rechazó inicialmente una limpieza que interpretó como demasiado amplia; esa limpieza se eliminó. Las pruebas actuales conservan los fixtures y no usan FLUSHDB ni borrados globales.

## Carga, pendientes y límites

- Carga local completada: 901 segundos, tres sesiones, consulta cada 5 segundos, 540 peticiones correctas y cero errores. Mediana de 45 ms, percentil 95 de 97 ms y máximo de 186 ms. Hasta tres peticiones simultáneas entre sesiones, ninguna superpuesta dentro de una misma sesión. Resultado en `storage/load-report.json`.
- Estado final de Redis: versión 8.0.5, AOF habilitado, política noeviction y memoria usada de 1 915 104 bytes (incluye fixtures de las pruebas; no es una medida aislada del consumo de tres usuarios). Evidencia en `storage/infra-report.json`.
- Pendiente el recorrido con tres dispositivos físicos y la validación específica del hosting: acceso privado a Redis, HTTPS, memoria, respaldo administrado y publicación.
- La restauración comprobada usa el mecanismo manual DUMP/RESTORE en la misma versión de Redis. No demuestra por sí sola la restauración de los respaldos que ofrezca el hosting ni la recuperación tras un corte eléctrico.
- No se automatizó el permiso GPS real del usuario ni una interrupción real de su red. La interfaz ofrece selección manual y recuperación de estado; la disponibilidad de GPS en teléfonos dependerá del contexto HTTPS y sus permisos.

Capturas verificadas: `storage/screenshots/movil-oferta.jpg`, `storage/screenshots/escritorio-oferta.jpg` y `storage/screenshots/escritorio-historial.jpg`. El recorrido visual se realizó con datos ficticios; la solicitud usada para las capturas se canceló con motivo y comentario al terminar.

## Guías aplicadas

Registro web actualizado por petición expresa del usuario: selector Pasajero/Chofer, vehículo obligatorio solo para chofer y aprobación manual confirmada por el usuario. Se aprobaron 42 verificaciones de servicios y 42 de API HTTP, incluidas alta pendiente, rechazo de autoaprobación, permisos, tipos inválidos, aprobación por CLI y acceso posterior. En navegador se verificaron el selector, la conservación de datos al alternar de tipo, el registro de una cuenta ficticia de chofer y el mensaje de aprobación pendiente al intentar acceder. Capturas: `storage/screenshots/registro-roles.jpg` y `storage/screenshots/chofer-pendiente.jpg`. Esta decisión sustituye el requisito anterior de creación exclusivamente manual de conductores; la aprobación sigue siendo manual.

Corrección del arranque desde Composer: el proceso PowerShell hijo no recibía stdin y Read-Host devolvía NULL. `composer conductor` ahora invoca `Uber\Console\CreateDriver::run` dentro del propio Composer y utiliza su IO interactiva. Se verificó el comando exacto en una terminal real: siete datos, contraseña oculta, confirmación, aprobación SI y creación correcta en un prefijo aleatorio de DB 15. Se verificó rechazo de `--no-interaction` con código no cero. El asistente PowerShell directo también maneja entrada cerrada con un mensaje claro: ocho comprobaciones aprobadas, más cuatro del CLI JSON.

Alta manual de conductores: asistente de consola `composer conductor`, sin formulario público ni panel administrativo. Siete verificaciones del asistente aprobadas tanto en PowerShell como Windows PowerShell: contraseña sin imprimir, conductor aprobado, UTF-8, hash y disponibilidad inicial, cancelación y contraseña de confirmación distinta. Cuatro comprobaciones adicionales del CLI rechazan JSON inválido, valores nulos/listas y tipos incorrectos con mensajes sin trazas. Los fixtures permanecen aislados en DB 15. No se creó una cuenta personal para el usuario, porque sus datos se introducen localmente al ejecutar el asistente.

Corrección posterior del mapa: selección continua por clic y arrastre sin reajustar zoom, direcciones de calles mediante Photon en vez de coordenadas en los inputs y conservación al recargar. Se verificó con una cuenta ficticia independiente: recogida actualizada a «Jirón Micaela Bastidas» por otro clic y a «Pasaje Tintaya» al arrastrar; destino «Jirón Juan de la Cruz Montaño». Consola sin errores. Captura: `storage/screenshots/direcciones-editables.jpg`. Nueve verificaciones locales de formato y coordenadas inválidas en `tests/geocoder.php` sin tráfico externo. La disponibilidad y cobertura del proveedor pueden exigir una referencia manual en algunos puntos.

Notion: spec-to-implementation y database-designer. UI Design: modo Build y reglas de colores, tipografía, fuentes, botones, formularios, responsividad, superficies, sombras, navegación, encabezados, flexbox, acceso, iconos/SVG, radios, copywriting, reglas generales y badges. Sites: entrega local sin publicación. Testing Best Practices: casos independientes, comprobaciones contra límites reales y escenarios de error. Computer Use: revisión mediante el navegador integrado.
