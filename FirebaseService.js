// ══════════════════════════════════════════════════════════
//  FIREBASESERVICE.GS
// ══════════════════════════════════════════════════════════

function getProjectId() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
}

function getFirestoreBaseUrl() {
  return 'https://firestore.googleapis.com/v1/projects/'
    + getProjectId() + '/databases/(default)/documents';
}

// ── Obtener token de acceso ───────────────────────────────
function getFirebaseToken() {
  var props       = PropertiesService.getScriptProperties();
  var clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
  var privateKey  = props.getProperty('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  var now     = Math.floor(Date.now() / 1000);
  var header  = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss  : clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud  : 'https://oauth2.googleapis.com/token',
    exp  : now + 3600,
    iat  : now
  }));

  var signInput = header + '.' + payload;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(signInput, privateKey)
  );
  var jwt = signInput + '.' + signature;

  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method     : 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload    : 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });

  return JSON.parse(response.getContentText()).access_token;
}

// ── Convertir objeto JS → formato Firestore ───────────────
function toFirestore(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(key) {
    var val = obj[key];
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { doubleValue: val };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = { arrayValue: { values: val.map(function(v) {
        if (typeof v === 'object' && v !== null) {
          return { mapValue: { fields: toFirestore(v) } };
        }
        return toFirestore({ v: v }).v;
      })}};
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestore(val) } };
    }
  });
  return fields;
}

// ── Convertir formato Firestore → objeto JS ───────────────
function fromFirestore(fields) {
  if (!fields) return {};
  var obj = {};
  Object.keys(fields).forEach(function(key) {
    var f = fields[key];
    if      (f.stringValue  !== undefined) obj[key] = f.stringValue;
    else if (f.doubleValue  !== undefined) obj[key] = f.doubleValue;
    else if (f.integerValue !== undefined) obj[key] = Number(f.integerValue);
    else if (f.booleanValue !== undefined) obj[key] = f.booleanValue;
    else if (f.nullValue    !== undefined) obj[key] = null;
    else if (f.arrayValue   !== undefined) {
      obj[key] = (f.arrayValue.values || []).map(function(v) {
        if (v.mapValue) return fromFirestore(v.mapValue.fields);
        return fromFirestore({ v: v }).v;
      });
    } else if (f.mapValue !== undefined) {
      obj[key] = fromFirestore(f.mapValue.fields);
    }
  });
  return obj;
}

// ── CRUD genérico ─────────────────────────────────────────
function fsGet(coleccion, id) {
  var token    = getFirebaseToken();
  var url      = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;
  var response = UrlFetchApp.fetch(url, {
    headers            : { Authorization: 'Bearer ' + token },
    muteHttpExceptions : true
  });
  var doc = JSON.parse(response.getContentText());
  if (!doc.fields) return null;
var obj   = fromFirestore(doc.fields);
var parts = doc.name.split('/');
obj.id    = parts[parts.length - 1];
return obj;
}

function fsGetAll(coleccion) {
  var token    = getFirebaseToken();
  var url      = getFirestoreBaseUrl() + '/' + coleccion;
  var response = UrlFetchApp.fetch(url, {
    headers            : { Authorization: 'Bearer ' + token },
    muteHttpExceptions : true
  });
  var data = JSON.parse(response.getContentText());
  if (!data.documents) return [];
  return data.documents.map(function(doc) {
    var obj   = fromFirestore(doc.fields);
    var parts = doc.name.split('/');
    obj.id    = parts[parts.length - 1];
    return obj;
  });
}

function fsCreate(coleccion, datos) {
  var id    = Utilities.getUuid();
  var token    = getFirebaseToken();
  var url      = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;
  UrlFetchApp.fetch(url, {
    method             : 'patch',
    contentType        : 'application/json',
    headers            : { Authorization: 'Bearer ' + token },
    payload            : JSON.stringify({ fields: toFirestore(datos) }),
    muteHttpExceptions : true
  });
  return id;
}

function fsUpdate(coleccion, id, datos) {
  var token  = getFirebaseToken();
  var fields = toFirestore(datos);
  var keys   = Object.keys(fields);
  
  // Construir updateMask para solo actualizar los campos enviados
  var maskParams = keys.map(function(k) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(k);
  }).join('&');

  var url = getFirestoreBaseUrl() + '/' + coleccion + '/' + id + '?' + maskParams;

  UrlFetchApp.fetch(url, {
    method             : 'patch',
    contentType        : 'application/json',
    headers            : { Authorization: 'Bearer ' + token },
    payload            : JSON.stringify({ fields: fields }),
    muteHttpExceptions : true
  });
}
function fsDelete(coleccion, id) {
  var token    = getFirebaseToken();
  var url      = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;
  UrlFetchApp.fetch(url, {
    method             : 'delete',
    headers            : { Authorization: 'Bearer ' + token },
    muteHttpExceptions : true
  });
}

function fsQuery(coleccion, campo, operador, valor) {
  var token    = getFirebaseToken();
  var url      = getFirestoreBaseUrl() + '/' + coleccion + '/' + id;

  var tipoValor = typeof valor === 'boolean' ? { booleanValue: valor }
                : typeof valor === 'number'  ? { doubleValue: valor }
                : { stringValue: String(valor) };

  var body = {
    structuredQuery: {
      from  : [{ collectionId: coleccion }],
      where : {
        fieldFilter: {
          field : { fieldPath: campo },
          op    : operador,
          value : tipoValor
        }
      }
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method             : 'post',
    contentType        : 'application/json',
    headers            : { Authorization: 'Bearer ' + token },
    payload            : JSON.stringify(body),
    muteHttpExceptions : true
  });

  var results = JSON.parse(response.getContentText());
  return results
    .filter(function(r) { return r.document; })
    .map(function(r) {
      var obj = fromFirestore(r.document.fields);
      obj.id  = r.document.name.split('/').pop();
      return obj;
    });
}
function fsQuery(coleccion, campo, operador, valor) {
  var token = getFirebaseToken();
  var url   = getFirestoreBaseUrl() + ':runQuery';

  var tipoValor = typeof valor === 'boolean' ? { booleanValue: valor }
                : typeof valor === 'number'  ? { doubleValue: valor }
                : { stringValue: String(valor) };

  var body = {
    structuredQuery: {
      from  : [{ collectionId: coleccion }],
      where : {
        fieldFilter: {
          field : { fieldPath: campo },
          op    : operador,
          value : tipoValor
        }
      }
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method             : 'post',
    contentType        : 'application/json',
    headers            : { Authorization: 'Bearer ' + token },
    payload            : JSON.stringify(body),
    muteHttpExceptions : true
  });

  var results = JSON.parse(response.getContentText());

  return results
    .filter(function(r) { return r.document; })
    .map(function(r) {
      var obj   = fromFirestore(r.document.fields);
      var parts = r.document.name.split('/');
      obj.id    = parts[parts.length - 1];
      return obj;
    });
}