// ══════════════════════════════════════════════════════════
//  CODIGO.GS  — Routing · Utilidades · Caché · Reportes
//  Fuente única para estas funciones. No duplicar en otros archivos.
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════════════════
function doGet(e) {
  var page     = (e.parameter.page || '').toLowerCase();
  var template = HtmlService.createTemplateFromFile(
    page === 'admin' ? 'Admin' : 'Index'
  );
  return template.evaluate()
    .setTitle('Gestión de Citas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ══════════════════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════════════════
function getFechaLocal() {
  return Utilities.formatDate(new Date(), 'America/El_Salvador', 'yyyy-MM-dd HH:mm:ss');
}

function formatearFecha(fecha) {
  if (fecha instanceof Date) {
    return Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(fecha).split('T')[0];
}

// ══════════════════════════════════════════════════════════
//  CACHÉ
// ══════════════════════════════════════════════════════════
function getCacheData(key) {
  var cache = CacheService.getScriptCache();
  try {
    var data = cache.get(key);
    return data ? JSON.parse(data) : null;
  } catch(e) {
    return null;
  }
}

function setCacheData(key, data, segundos) {
  var cache = CacheService.getScriptCache();
  try {
    if (data === null) {
      cache.remove(key);  // null = invalidar, no guardar vacío
    } else {
      cache.put(key, JSON.stringify(data), segundos || 300);
    }
  } catch(e) {
    // Dato muy grande para caché, se ignora
  }
}

// ══════════════════════════════════════════════════════════
//  REPORTES
// ══════════════════════════════════════════════════════════
function obtenerReporte(fechaInicio, fechaFin) {
  var citas     = fsGetAll('citas');
  var empleados = obtenerEmpleados();

  var filtradas = citas.filter(function(c) {
    var f = formatearFecha(c.fecha);
    return f >= fechaInicio && f <= fechaFin;
  });

  var completadas  = 0;
  var canceladas   = 0;
  var ingresoTotal = 0;
  var conteoEmp    = {};

  filtradas.forEach(function(c) {
    if (c.estado === 'Completada') {
      completadas++;
      ingresoTotal += Number(c.total) || 0;
    }
    if (c.estado === 'Cancelada') canceladas++;

    if (c.id_empleado) {
      var idEmp = String(c.id_empleado);
      conteoEmp[idEmp] = (conteoEmp[idEmp] || 0) + 1;
    }
  });

  // Resolver nombre real del empleado top
  var empleadoTop = null;
  var maxCitas    = 0;
  Object.keys(conteoEmp).forEach(function(idEmp) {
    if (conteoEmp[idEmp] > maxCitas) {
      maxCitas    = conteoEmp[idEmp];
      var emp     = empleados.find(function(e) { return String(e.id) === idEmp; });
      empleadoTop = emp ? emp.nombre_empleado : idEmp;
    }
  });

  return {
    periodo      : fechaInicio + ' al ' + fechaFin,
    totalCitas   : filtradas.length,
    completadas  : completadas,
    canceladas   : canceladas,
    ingresoTotal : ingresoTotal,
    empleadoTop  : empleadoTop
  };
}

// Contador diario de citas. Debe llamarse dentro de un lock (ver crearCitaPublica).
function getNextCitaNumero() {
  var hoy   = getFechaLocal().split(' ')[0];
  var docId = 'contador_' + hoy.replace(/-/g, '');

  var actual = fsGet('config', docId);
  var numero = actual ? Number(actual.valor) + 1 : 1;

  fsUpdate('config', docId, { valor: numero, fecha: hoy });
  return numero;
}
