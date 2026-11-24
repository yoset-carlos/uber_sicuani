<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#5F66F5">
  <meta name="description" content="Uber Sicuani: práctica académica de viajes simulados con pasajeros y conductores.">
  <title>Uber Sicuani — Tu próximo viaje</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <link rel="apple-touch-icon" href="/assets/logo-icon.png">
  <link rel="preload" href="/assets/vendor/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/vendor/leaflet.css">
  <link rel="stylesheet" href="/assets/app.css?v=<?= substr(hash_file('sha256', dirname(__DIR__).'/public/assets/app.css'),0,12) ?>">
  <script src="/assets/vendor/leaflet.js" defer></script>
  <script src="/assets/sheet.js?v=<?= substr(hash_file('sha256', dirname(__DIR__).'/public/assets/sheet.js'),0,12) ?>" defer></script>
  <script src="/assets/app.js?v=<?= substr(hash_file('sha256', dirname(__DIR__).'/public/assets/app.js'),0,12) ?>" defer></script>
</head>
<body data-screen="loading">
  <a class="skip" href="#panel">Ir a los controles del viaje</a>
  <div id="app">
    <header class="header">
      <a class="brand" href="/" aria-label="Uber Sicuani, inicio"><img class="brand-logo" src="/assets/logo.png" alt="Uber Sicuani" width="120" height="45"></a>
      <span class="demo-label">Viajes simulados</span>
    </header>
    <div class="topbar" id="topbar">
      <button type="button" class="round-button" id="back" aria-label="Volver" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <span class="demo-chip">Viajes simulados</span>
    </div>
    <div class="route-card" id="route-card" hidden></div>
    <main class="workspace">
      <section class="map-wrap" aria-label="Mapa de origen y destino">
        <div id="map" aria-label="Mapa de Sicuani"></div>
        <div class="map-caption"><span class="map-dot"></span><div><strong>Sicuani, Cusco</strong><p>Tu ciudad. Tu próximo destino.</p></div></div>
        <div id="map-instruction" class="map-instruction" hidden></div>
        <div id="tile-warning" class="map-warning" role="status" hidden>No se pudo cargar parte del mapa. Tus puntos se conservan. Revisa la conexión.</div>
      </section>
      <section id="panel" class="panel" aria-label="Controles del viaje" tabindex="-1">
        <div class="sheet-toolbar" aria-label="Altura del panel">
          <button type="button" id="sheet-lower" class="sheet-step" aria-label="Bajar panel" aria-controls="panel-scroll"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
          <button type="button" id="sheet-handle" class="sheet-handle" aria-label="Cambiar altura del panel" aria-controls="panel-scroll" aria-expanded="true"><span aria-hidden="true"></span></button>
          <button type="button" id="sheet-raise" class="sheet-step" aria-label="Subir panel" aria-controls="panel-scroll"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
          <span id="sheet-status" class="sr-only" role="status" aria-live="polite"></span>
        </div>
        <div id="panel-scroll" class="panel-scroll"><div id="panel-content"><p class="muted loading">Preparando tu próximo viaje…</p></div></div>
      </section>
    </main>
    <nav aria-label="Navegación principal" id="navigation" class="tabbar" hidden>
      <button type="button" class="tab" data-view="home"><span class="pill" aria-hidden="true"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span class="tab-label" id="home-label">Viajar</span></button>
      <button type="button" class="tab" data-view="history"><span class="pill" aria-hidden="true"></span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="tab-label">Actividad</span></button>
      <a class="tab" href="/como-funciona"><span class="pill" aria-hidden="true"></span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5"/><path d="M12 17h.01"/></svg><span class="tab-label">Guía</span></a>
      <button type="button" class="tab" data-view="account"><span class="pill" aria-hidden="true"></span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span class="tab-label">Cuenta</span></button>
    </nav>
    <footer class="footer"><span>Hecho para moverse por Sicuani.</span><span>Proyecto académico · Sin cobros reales</span></footer>
  </div>
  <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
  <dialog id="action-dialog" aria-labelledby="dialog-title"><form id="dialog-form"><div class="dialog-header"><h2 id="dialog-title"></h2><button type="button" class="icon-button" id="close-dialog" aria-label="Cerrar diálogo"><span data-icon="XMarkIcon"></span></button></div><div id="dialog-content"></div><p id="dialog-error" role="alert" class="error-text" hidden></p><button class="primary" type="submit" id="dialog-submit">Guardar cambios</button></form></dialog>
  <dialog id="rating-dialog" class="rating-dialog" aria-labelledby="rating-title"><form id="rating-form"><div id="rating-content"></div></form></dialog>
  <noscript>Activa JavaScript para utilizar el mapa y solicitar viajes simulados.</noscript>
</body>
</html>
