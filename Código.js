// ══════════════════════════════════════════════════════════
//  CODIGO.GS  — Routing · Utilidades · Caché · Reportes
//  Fuente única para estas funciones. No duplicar en otros archivos.
// ══════════════════════════════════════════════════════════

var SS = SpreadsheetApp.getActiveSpreadsheet();

var SHEET = {
  CONFIG         : 'Config',
  SERVICIOS      : 'Servicios',
  PRODUCTOS      : 'Productos',
  CLIENTES       : 'Clientes',
  EMPLEADOS      : 'Empleados',
  AGENDA         : 'Agenda',
  CITAS          : 'Citas_programadas',
  CITA_PRODUCTOS : 'Cita_Productos',
};

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
function getSheet(nombre) {
  var sheet = SS.getSheetByName(nombre);
  if (!sheet) throw new Error('Hoja no encontrada: ' + nombre);
  return sheet;
}

function sheetToObjects(sheetName) {
  var sheet   = getSheet(sheetName);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows    = data.slice(1);

  return rows
    .filter(function(row) {
      return row.some(function(cell) { return cell !== '' && cell !== null; });
    })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) {
        var val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        }
        obj[h] = val;
      });
      return obj;
    });
}

function getFechaLocal() {
  return Utilities.formatDate(new Date(), 'America/El_Salvador', 'yyyy-MM-dd HH:mm:ss');
}

function formatearFecha(fecha) {
  if (fecha instanceof Date) {
    return Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(fecha).split('T')[0];
}

function findRowIndex(sheet, colIndex, value) {
  var values = sheet.getRange(1, colIndex + 1, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] == value) return i + 1;
  }
  return -1;
}

function getNextIdCounter(tabla) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet  = getSheet(SHEET.CONFIG);
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === tabla) {
        var nuevoId = Number(values[i][1]) + 1;
        sheet.getRange(i + 1, 2).setValue(nuevoId);
        return nuevoId;
      }
    }
    throw new Error('Tabla no encontrada en Config: ' + tabla);
  } finally {
    lock.releaseLock();
  }
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
  var citas     = sheetToObjects(SHEET.CITAS);
  var empleados = getCacheData('empleados') || sheetToObjects(SHEET.EMPLEADOS);

  var filtradas = citas.filter(function(c) {
    var f = formatearFecha(c.Fecha);
    return f >= fechaInicio && f <= fechaFin;
  });

  var completadas  = 0;
  var canceladas   = 0;
  var ingresoTotal = 0;
  var conteoEmp    = {};

  filtradas.forEach(function(c) {
    if (c.Estado === 'Completada') {
      completadas++;
      ingresoTotal += Number(c.Total) || 0;
    }
    if (c.Estado === 'Cancelada') canceladas++;

    if (c.ID_Empleado) {
      var idEmp = String(c.ID_Empleado);
      conteoEmp[idEmp] = (conteoEmp[idEmp] || 0) + 1;
    }
  });

  // Resolver nombre real del empleado top
  var empleadoTop = null;
  var maxCitas    = 0;
  Object.keys(conteoEmp).forEach(function(idEmp) {
    if (conteoEmp[idEmp] > maxCitas) {
      maxCitas    = conteoEmp[idEmp];
      var emp     = empleados.find(function(e) {
        return String(e.ID_Empleado) === idEmp;
      });
      empleadoTop = emp ? emp.Nombre_Empleado : idEmp;
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

function getNextCitaNumero() {
  var hoy   = getFechaLocal().split(' ')[0];
  var docId = 'contador_' + hoy.replace(/-/g, '');

  var token = getFirebaseToken();
  var url   = getFirestoreBaseUrl() + '/config/' + docId;

  // Intentar leer el contador del día
  var response = UrlFetchApp.fetch(url, {
    headers            : { Authorization: 'Bearer ' + token },
    muteHttpExceptions : true
  });

  var doc    = JSON.parse(response.getContentText());
  var numero = 1;

  if (doc.fields) {
    // Ya existe — incrementar
    numero = Number(fromFirestore(doc.fields).valor) + 1;
  }

  // Guardar el nuevo valor
  UrlFetchApp.fetch(url, {
    method      : 'patch',
    contentType : 'application/json',
    headers     : { Authorization: 'Bearer ' + token },
    payload     : JSON.stringify({ fields: toFirestore({ valor: numero, fecha: hoy }) }),
    muteHttpExceptions: true
  });

  return numero;
}

function testCrearCita() {
  try {
    var id = crearCitaPublica(
      'Test Cliente',
      '71234567',
      'ID_EMPLEADO_AQUI',  // pon el UUID real de un empleado
      'ID_SERVICIO_AQUI',  // pon el UUID real de un servicio
      'ID_AGENDA_AQUI',    // pon el UUID real de un slot de agenda
      '2026-07-04',
      '09:00',
      'Efectivo',
      []
    );
    Logger.log('Cita creada: ' + id);
  } catch(e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
}


