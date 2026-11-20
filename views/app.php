<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#141414">
  <meta name="description" content="Uber Sicuani: práctica académica de viajes simulados con pasajeros y conductores.">
  <title>Uber Sicuani — Tu próximo viaje</title>
  <link rel="icon" href="data:,">
  <link rel="preload" href="/assets/vendor/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/vendor/leaflet.css">
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/assets/vendor/leaflet.js" defer></script>
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <a class="skip" href="#panel">Ir a los controles del viaje</a>
  <div id="app">
    <header class="header">
      <a class="brand" href="/" aria-label="Uber Sicuani, inicio">Uber<span>Sicuani</span></a>
      <nav aria-label="Navegación principal" id="navigation" hidden>
        <button type="button" data-view="home" aria-current="page">Viajar</button>
        <button type="button" data-view="history">Actividad</button>
      </nav>
      <div class="header-end"><span class="demo-label">Viajes simulados</span><button type="button" id="menu-toggle" class="icon-button" aria-label="Abrir menú de cuenta" aria-expanded="false" aria-controls="account-menu" hidden><span data-icon="Bars3Icon"></span></button></div>
      <div class="account-menu" id="account-menu" hidden><p id="account-name"></p><p id="account-role" class="muted"></p><button type="button" id="logout">Cerrar sesión</button></div>
    </header>
    <main class="workspace">
      <section class="map-wrap" aria-label="Mapa de origen y destino">
        <div id="map" aria-label="Mapa de Sicuani"></div>
        <div class="map-caption"><span class="map-dot"></span><div><strong>Sicuani, Cusco</strong><p>Tu ciudad. Tu próximo destino.</p></div></div>
        <div id="map-instruction" class="map-instruction" hidden></div>
        <div id="tile-warning" class="map-warning" role="status" hidden>No se pudo cargar parte del mapa. Tus puntos se conservan. Revisa la conexión.</div>
      </section>
      <section id="panel" class="panel" aria-label="Controles del viaje" tabindex="-1">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div id="panel-content"><p class="muted loading">Preparando tu próximo viaje…</p></div>
      </section>
    </main>
    <footer class="footer"><span>Hecho para moverse por Sicuani.</span><span>Proyecto académico · Sin cobros reales</span></footer>
  </div>
  <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
  <dialog id="action-dialog" aria-labelledby="dialog-title"><form id="dialog-form"><div class="dialog-header"><h2 id="dialog-title"></h2><button type="button" class="icon-button" id="close-dialog" aria-label="Cerrar diálogo"><span data-icon="XMarkIcon"></span></button></div><div id="dialog-content"></div><p id="dialog-error" role="alert" class="error-text" hidden></p><button class="primary" type="submit" id="dialog-submit">Guardar cambios</button></form></dialog>
  <noscript>Activa JavaScript para utilizar el mapa y solicitar viajes simulados.</noscript>
</body>
</html>
