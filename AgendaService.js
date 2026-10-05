// ══════════════════════════════════════════════════════════
//  AGENDASERVICE.GS — Agenda
//  Fuente de datos: Firebase Firestore
// ══════════════════════════════════════════════════════════

function sumarDias(fechaStr, dias) {
  var parts = fechaStr.split('-').map(Number);
  var fecha = new Date(parts[0], parts[1] - 1, parts[2]);
  fecha.setDate(fecha.getDate() + dias);
  var yyyy = fecha.getFullYear();
  var mm   = String(fecha.getMonth() + 1).padStart(2, '0');
  var dd   = String(fecha.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function sumarMinutos(hora, minutos) {
  var partes   = hora.split(':').map(Number);
  var totalMin = partes[0] * 60 + partes[1] + minutos;
  var nuevaH   = Math.floor(totalMin / 60) % 24;
  var nuevaM   = totalMin % 60;
  return (nuevaH < 10 ? '0' : '') + nuevaH + ':' + (nuevaM < 10 ? '0' : '') + nuevaM;
}

// ══════════════════════════════════════════════════════════
//  GENERAR AGENDA
// ══════════════════════════════════════════════════════════
function generarAgenda(idEmpleado, fechaInicio, fechaFin, horaInicioDia, horaFinDia, duracionMin) {
  var fechaActual = fechaInicio;
  var idEmp       = String(idEmpleado); // forzar string
  var docs        = [];

  while (fechaActual <= fechaFin) {
    var horaActual = horaInicioDia;
    while (horaActual < horaFinDia) {
      var horaFinSlot = sumarMinutos(horaActual, duracionMin);
      if (horaFinSlot > horaFinDia) break;

      docs.push({
        coleccion : 'agenda',
        datos     : {
          id_empleado : idEmp,
          fecha       : String(fechaActual),
          hora_inicio : String(horaActual),
          hora_fin    : String(horaFinSlot),
          disponible  : true
        }
      });

      horaActual = horaFinSlot;
    }
    fechaActual = sumarDias(fechaActual, 1);
  }

  if (docs.length > 0) fsCreateBatch(docs);
}

// ══════════════════════════════════════════════════════════
//  CONSULTAR DISPONIBILIDAD
// ══════════════════════════════════════════════════════════
function obtenerDisponibilidad(idEmpleado, fecha) {
  return fsQuery('agenda', 'id_empleado', 'EQUAL', String(idEmpleado))
    .filter(function(a) {
      return String(a.fecha) === String(fecha) && a.disponible === true;
    })
    .sort(function(a, b) {
      return String(a.hora_inicio) < String(b.hora_inicio) ? -1 : 1;
    })
    .map(function(a) {
      return {
        ID_Agenda   : a.id,
        ID_Empleado : a.id_empleado,
        Fecha       : a.fecha,
        Hora_inicio : a.hora_inicio,
        Hora_fin    : a.hora_fin,
        Disponible  : a.disponible
      };
    });
}

// ══════════════════════════════════════════════════════════
//  OCUPAR / LIBERAR
// ══════════════════════════════════════════════════════════
function ocuparHorario(idAgenda) {
  fsUpdate('agenda', idAgenda, { disponible: false });
  return true;
}

function liberarHorario(idAgenda) {
  fsUpdate('agenda', idAgenda, { disponible: true });
  return true;
}