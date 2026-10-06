/* =========================================================
   MÓDULO: Gestión de Talleristas / Proveedores AT con Artículos
   v2.1 — Agregar tallerista o proveedor AT, asignar artículos + teléfono.
   v2.0: guarda en la tabla correcta según tipo:
     - prov_at   → Articulos x Prov AT
     - tallerista → Codigos X Tallerista + Articulos Virgilio X Tallerista
   v2.1: + campo telefono en Tall_ProvAT_PS
   ========================================================= */

let _tallArtModal = null, _tallArtState = {};

async function tallArtInit() {
  // Crear modal si no existe
  if (!document.getElementById("tallArtModal")) {
    const modal = document.createElement("div");
    modal.id = "tallArtModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content tall-art-modal">
        <div class="modal-header">
          <h2>➕ Nuevo Tallerista / Proveedor AT</h2>
          <button onclick="tallArtClose()" class="modal-close">×</button>
        </div>
        <div class="modal-body">

          <!-- PASO 1: Datos básicos -->
          <div id="tallArtStep1" class="tall-art-step">
            <h3>Paso 1: Datos básicos</h3>
            <div class="form-group">
              <label>Nombre del tallerista/proveedor:</label>
              <input id="tallArtNombre" type="text" placeholder="Ej: Cabral, Maspoli, etc" class="form-input">
            </div>
            <div class="form-group">
              <label>Teléfono:</label>
              <input id="tallArtTelefono" type="text" placeholder="Ej: +54 9 11 1234-5678" class="form-input">
            </div>
            <div class="form-group">
              <label>Tipo:</label>
              <div class="radio-group">
                <label><input type="radio" name="tallArtTipo" value="tallerista"> Tallerista (recibe partes)</label>
                <label><input type="radio" name="tallArtTipo" value="prov_at" checked> Proveedor AT (entrega artículos terminados)</label>
              </div>
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="tallArtActivo" checked> Activo</label>
            </div>
            <button onclick="tallArtStep1Next()" class="btn-primary">Siguiente → Artículos</button>
          </div>

          <!-- PASO 2: Búsqueda y selección de artículos -->
          <div id="tallArtStep2" class="tall-art-step hidden">
            <h3>Paso 2: Asignar Artículos</h3>
            <p style="font-size:13px; color:#64748b; margin-bottom:12px;">
              Busca y selecciona los artículos. Los datos de descripción y unidades se cargan automáticamente.
            </p>
            <div class="form-group">
              <label>Buscar artículos:</label>
              <input id="tallArtArtSearch" type="text" placeholder="🔎 código, descripción..." class="form-input" oninput="tallArtFilterArts()">
            </div>
            <div id="tallArtArtList" class="tall-art-arts-list" style="max-height:300px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; padding:8px;">
              <div class="loading">Cargando artículos...</div>
            </div>
            <div style="margin-top:12px; font-size:12px; color:#64748b;">
              <b>Seleccionados:</b> <span id="tallArtSelCount">0</span> artículos
            </div>
            <div class="tall-art-buttons" style="margin-top:16px;">
              <button onclick="tallArtStep2Back()" class="btn-secondary">← Atrás</button>
              <button onclick="tallArtStep2Next()" class="btn-primary">Siguiente → Validar</button>
            </div>
          </div>

          <!-- PASO 3: Validación de overlaps y marcas -->
          <div id="tallArtStep3" class="tall-art-step hidden">
            <h3>Paso 3: Validar Marcas</h3>
            <p style="font-size:13px; color:#64748b; margin-bottom:12px;">
              Algunos artículos existen en otros talleristas. Confirmá la marca (LK/CH) para cada uno.
            </p>
            <div id="tallArtOverlapList" style="max-height:300px; overflow-y:auto;">
              <!-- Llenado por JS -->
            </div>
            <div class="tall-art-buttons" style="margin-top:16px;">
              <button onclick="tallArtStep3Back()" class="btn-secondary">← Atrás</button>
              <button onclick="tallArtStep3Save()" class="btn-primary">💾 Guardar Todo</button>
            </div>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(modal);
    _tallArtModal = modal;
  }

  // Estilos
  if (!document.getElementById("tallArtStyles")) {
    const style = document.createElement("style");
    style.id = "tallArtStyles";
    style.textContent = `
      .tall-art-modal { min-width: 500px; max-width: 600px; }
      .tall-art-step { display: block; }
      .tall-art-step.hidden { display: none; }
      .tall-art-arts-list { border: 1px solid #e2e8f0; }
      .tall-art-art-item { padding: 8px; border-bottom: 1px solid #f0f0f0; cursor: pointer; border-radius: 4px; }
      .tall-art-art-item:hover { background: #f9fafb; }
      .tall-art-art-item.selected { background: #dbeafe; border-left: 4px solid #3b82f6; }
      .tall-art-art-item input { margin-right: 8px; }
      .tall-art-buttons { display: flex; gap: 8px; justify-content: flex-end; }
      .tall-art-overlap-item { padding: 12px; border: 1px solid #fde047; background: #fefce8; border-radius: 6px; margin-bottom: 8px; }
      .tall-art-overlap-item select { margin-top: 6px; padding: 4px; }
      .modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
      .modal.hidden { display: none; }
      .modal-content { background: white; border-radius: 8px; padding: 20px; max-height: 90vh; overflow-y: auto; }
      .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .modal-close { background: none; border: none; font-size: 24px; cursor: pointer; }
      .form-group { margin-bottom: 12px; }
      .form-group label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 13px; }
      .form-input { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; }
      .radio-group { display: flex; flex-direction: column; gap: 6px; }
      .radio-group label { font-weight: normal; display: flex; align-items: center; }
      .btn-primary { background: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
      .btn-primary:hover { background: #2563eb; }
      .btn-secondary { background: #e2e8f0; color: #1e293b; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
      .loading { text-align: center; padding: 16px; color: #64748b; }
    `;
    document.head.appendChild(style);
  }
}

function tallArtOpen() {
  tallArtInit();
  _tallArtState = { nombre: "", tipo: "prov_at", activo: true, artsSelected: {}, overlaps: {} };
  document.getElementById("tallArtStep1").classList.remove("hidden");
  document.getElementById("tallArtStep2").classList.add("hidden");
  document.getElementById("tallArtStep3").classList.add("hidden");
  _tallArtModal.classList.remove("hidden");
}

function tallArtClose() {
  if (_tallArtModal) _tallArtModal.classList.add("hidden");
  _tallArtState = {};
}

async function tallArtStep1Next() {
  var nombre = document.getElementById("tallArtNombre").value.trim();
  if (!nombre) { alert("Ingresá el nombre del tallerista/proveedor."); return; }

  var H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

  // Verificar que no exista en Tall_ProvAT_PS
  var chk = await fetch(SUPABASE_URL + "/rest/v1/Tall_ProvAT_PS?nombre=eq." + encodeURIComponent(nombre) + "&select=nombre", { headers: H }).then(function(r) { return r.json(); }).catch(function() { return []; });
  if (chk.length) { alert("Ya existe un tallerista/proveedor con ese nombre."); return; }

  _tallArtState.nombre = nombre;
  _tallArtState.telefono = document.getElementById("tallArtTelefono").value.trim() || "";
  _tallArtState.tipo = document.querySelector('input[name="tallArtTipo"]:checked').value;
  _tallArtState.activo = document.getElementById("tallArtActivo").checked;

  // Para talleristas, pre-cargar códigos existentes de Codigos X Tallerista
  if (_tallArtState.tipo === "tallerista") {
    var existCods = await fetch(
      SUPABASE_URL + "/rest/v1/Codigos%20X%20Tallerista?Nombre=eq." + encodeURIComponent(nombre) + "&select=Linea,Codigo",
      { headers: H }
    ).then(function(r) { return r.json(); }).catch(function() { return []; });
    var codMap = {};
    (existCods || []).forEach(function(r) { codMap[r.Linea] = r.Codigo; });
    _tallArtState.existingCodMap = codMap;
  }

  // Ir al paso 2
  document.getElementById("tallArtStep1").classList.add("hidden");
  document.getElementById("tallArtStep2").classList.remove("hidden");
  await tallArtLoadArts();
}

async function tallArtLoadArts() {
  try {
    // v11.77 — buscar en OC_Maximos (catálogo completo) + enriquecer con datos
    // de Articulos Virgilio X Tallerista (Uni_x_Caja) si ya estaban asignados.
    var ocArtsP = supaFetchAllSafe(SUPABASE_URL + "/rest/v1/OC_Maximos", "select=cod,descripcion&activo=eq.true");
    var assignedP = supaFetchAllSafe(SUPABASE_URL + "/rest/v1/Articulos%20Virgilio%20X%20Tallerista", "select=Cod_Art,Desc,Uni_x_Caja");
    var results = await Promise.all([ocArtsP, assignedP]);
    var ocArts = results[0], assigned = results[1];
    // Indexar asignados por cod para enriquecer
    var assignedMap = {};
    (assigned || []).forEach(function(a) { assignedMap[a.Cod_Art] = a; });
    // Deduplicar: OC_Maximos es la fuente, enriquecido con Uni_x_Caja si existe
    var seen = {};
    var merged = [];
    (ocArts || []).forEach(function(o) {
      if (!o.cod || seen[o.cod]) return;
      seen[o.cod] = true;
      var a = assignedMap[o.cod];
      merged.push({ Cod_Art: o.cod, Desc: (a && a.Desc) || o.descripcion || "", Uni_x_Caja: (a && a.Uni_x_Caja) || null });
    });
    // Agregar asignados que no estén en OC_Maximos (por si acaso)
    (assigned || []).forEach(function(a) {
      if (!a.Cod_Art || seen[a.Cod_Art]) return;
      seen[a.Cod_Art] = true;
      merged.push(a);
    });
    _tallArtState.allArts = merged;
    tallArtFilterArts();
  } catch (e) {
    console.error("Error cargando artículos:", e);
    document.getElementById("tallArtArtList").innerHTML = '<div class="loading" style="color:red;">Error al cargar artículos.</div>';
  }
}

function tallArtFilterArts() {
  var q = (document.getElementById("tallArtArtSearch").value || "").toLowerCase().trim();
  var arts = (_tallArtState.allArts || []).filter(function(a) {
    var cod = String(a.Cod_Art || "").toLowerCase();
    var desc = String(a.Desc || "").toLowerCase();
    return q === "" || cod.includes(q) || desc.includes(q);
  });

  var listEl = document.getElementById("tallArtArtList");
  if (!arts.length) {
    listEl.innerHTML = '<div class="loading">No se encontraron artículos.</div>';
    return;
  }

  var html = '';
  arts.forEach(function(a) {
    var artId = a.Cod_Art;
    var checked = _tallArtState.artsSelected[artId] ? 'checked' : '';
    html += '<div class="tall-art-art-item ' + (_tallArtState.artsSelected[artId] ? 'selected' : '') + '">' +
      '<input type="checkbox" value="' + artId + '" ' + checked + ' onchange="tallArtToggleArt(\'' + artId + '\', this.checked)">' +
      '<b>' + a.Cod_Art + '</b> — ' + (a.Desc || '?') + ' <small>(' + (a.Uni_x_Caja || 1) + ' u/caja)</small>' +
      '</div>';
  });
  listEl.innerHTML = html;
  document.getElementById("tallArtSelCount").textContent = Object.keys(_tallArtState.artsSelected).length;
}

function tallArtToggleArt(artId, checked) {
  if (checked) {
    var art = (_tallArtState.allArts || []).find(function(a) { return a.Cod_Art === artId; });
    if (art) {
      _tallArtState.artsSelected[artId] = { cod: artId, desc: art.Desc, uni: art.Uni_x_Caja || 1, marca: "" };
    }
  } else {
    delete _tallArtState.artsSelected[artId];
  }
  tallArtFilterArts();
}

function tallArtStep2Back() {
  document.getElementById("tallArtStep2").classList.add("hidden");
  document.getElementById("tallArtStep1").classList.remove("hidden");
}

async function tallArtStep2Next() {
  var arts = Object.keys(_tallArtState.artsSelected);
  if (!arts.length) { alert("Seleccioná al menos 1 artículo."); return; }

  var H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  var tipo = _tallArtState.tipo;
  try {
    var existing = [];
    if (tipo === "prov_at") {
      // Proveedores AT: buscar overlaps en Articulos x Prov AT
      existing = await fetch(
        SUPABASE_URL + "/rest/v1/Articulos%20x%20Prov%20AT?Cod_Art=in.(" + arts.map(encodeURIComponent).join(",") + ")&select=Cod_Art,Proveedor,marca",
        { headers: H }
      ).then(function(r) { return r.json(); }).catch(function() { return []; });
    } else {
      // Talleristas: buscar overlaps en Articulos Virgilio X Tallerista
      existing = await fetch(
        SUPABASE_URL + "/rest/v1/Articulos%20Virgilio%20X%20Tallerista?Cod_Art=in.(" + arts.map(encodeURIComponent).join(",") + ")&select=Cod_Art,Tallerista,Linea",
        { headers: H }
      ).then(function(r) { return r.json(); }).catch(function() { return []; });
    }

    _tallArtState.overlaps = {};
    (existing || []).forEach(function(row) {
      if (!_tallArtState.overlaps[row.Cod_Art]) _tallArtState.overlaps[row.Cod_Art] = [];
      if (tipo === "prov_at") {
        _tallArtState.overlaps[row.Cod_Art].push({ prov: row.Proveedor, marca: row.marca });
      } else {
        _tallArtState.overlaps[row.Cod_Art].push({ prov: row.Tallerista, marca: row.Linea });
      }
    });

    var hasOverlaps = Object.keys(_tallArtState.overlaps).length > 0;
    if (hasOverlaps) {
      tallArtStep2ToStep3();
    } else {
      await tallArtStep3Save();
    }
  } catch (e) {
    console.error("Error detectando overlaps:", e);
    alert("Error al verificar artículos duplicados.");
  }
}

function tallArtStep2ToStep3() {
  document.getElementById("tallArtStep2").classList.add("hidden");
  document.getElementById("tallArtStep3").classList.remove("hidden");

  var tipo = _tallArtState.tipo;
  var html = '';
  var artsWithOverlap = Object.keys(_tallArtState.overlaps).filter(function(a) { return _tallArtState.overlaps[a].length > 0; });

  artsWithOverlap.forEach(function(artId) {
    var art = _tallArtState.artsSelected[artId];
    var existing = _tallArtState.overlaps[artId];
    var existingStr = existing.map(function(e) { return e.prov + (e.marca ? ' (' + e.marca + ')' : ''); }).join(', ');

    html += '<div class="tall-art-overlap-item">' +
      '<b>' + artId + '</b> — ' + (art.desc || '?') + '<br>' +
      '<small style="color:#666;">Ya existe en: ' + existingStr + '</small>';

    if (tipo === "prov_at") {
      html += '<div style="margin-top:8px;">' +
        '<label>Marca para este proveedor:</label>' +
        '<select id="marca_' + artId + '" style="padding:6px; border:1px solid #cbd5e1; border-radius:4px; width:100%;">' +
        '<option value="">— Sin marca específica</option>' +
        '<option value="LK">LK (Loekemeyer)</option>' +
        '<option value="CH">CH (Chef)</option>' +
        '</select></div>';
    }
    html += '</div>';
  });

  document.getElementById("tallArtOverlapList").innerHTML = html || '<div style="color:#64748b;">Sin overlaps detectados.</div>';
}

function tallArtStep3Back() {
  document.getElementById("tallArtStep3").classList.add("hidden");
  document.getElementById("tallArtStep2").classList.remove("hidden");
}

async function tallArtStep3Save() {
  var H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  var nombre = _tallArtState.nombre;
  var tipo = _tallArtState.tipo;
  var activo = _tallArtState.activo;

  try {
    // 1. Insertar en Tall_ProvAT_PS
    var tallBody = {
      nombre: nombre, telefono: _tallArtState.telefono || null, activo: activo, rec_virg: true, rec_cerv: false,
      ctrl_tall: tipo === "tallerista", solo_grj: false, mostrar_grj: false,
      prov_at: tipo === "prov_at", interno: false, ps: false,
      notas: "Creado " + new Date().toLocaleDateString("es-AR")
    };
    var tallRes = await fetch(SUPABASE_URL + "/rest/v1/Tall_ProvAT_PS", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(tallBody)
    });
    if (!tallRes.ok) {
      var errTxt = await tallRes.text().catch(function() { return ""; });
      throw new Error("No se pudo guardar (HTTP " + tallRes.status + ")" + (errTxt ? ": " + errTxt : ""));
    }

    // 2. Insertar artículos en la tabla correcta según tipo
    var artCount = 0;

    if (tipo === "prov_at") {
      // ─── Proveedor AT → OC_Maximos (con lógica de % = 100% al nuevo proveedor) ───
      var codsToProcess = Object.keys(_tallArtState.artsSelected);
      var warnings = [];

      // Verificar si los códigos ya existen en OC_Maximos con otro proveedor
      if (codsToProcess.length) {
        var existingCodsRes = await fetch(
          SUPABASE_URL + "/rest/v1/OC_Maximos?cod=in.(" + codsToProcess.map(encodeURIComponent).join(",") + ")&select=cod,proveedor,proveedor2",
          { headers: H }
        ).then(function(r) { return r.json(); }).catch(function() { return []; });

        (existingCodsRes || []).forEach(function(row) {
          var prov1 = String(row.proveedor || "").trim();
          var prov2 = String(row.proveedor2 || "").trim();
          if (prov1 || prov2) {
            warnings.push("• " + row.cod + ": actualmente asignado a " + (prov1 ? prov1 : "") + (prov2 ? " y " + prov2 : ""));
          }
        });
      }

      if (warnings.length) {
        var msg = "Los siguientes códigos ya están asignados a otros proveedores:\n\n" + warnings.join("\n") +
          "\n\nSe van a REEMPLAZAR asignándolos 100% a " + nombre + ".\n" +
          "Si querés distribuir entre múltiples proveedores, editar después en ✏️ Editar.";
        if (!confirm(msg)) {
          alert("Cancelado.");
          return;
        }
      }

      // Insertar/actualizar en OC_Maximos
      var upsertPromises = [];
      Object.keys(_tallArtState.artsSelected).forEach(function(cod) {
        var art = _tallArtState.artsSelected[cod];
        var body = {
          cod: cod, descripcion: art.desc || "?", proveedor: nombre,
          prop_prov1: 100, proveedor2: null, prop_prov2: 0,
          linea: "LK", max_cajas: 0, indice: 1.5, activo: true
        };
        upsertPromises.push(
          fetch(SUPABASE_URL + "/rest/v1/OC_Maximos", {
            method: "POST",
            headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify(body)
          }).then(function(r) {
            if (r.status === 409) {
              // Ya existe → PATCH
              return fetch(SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod), {
                method: "PATCH",
                headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ proveedor: nombre, prop_prov1: 100, proveedor2: null, prop_prov2: 0 })
              });
            }
            return r;
          }).then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status + " (" + cod + ")");
          })
        );
      });

      if (upsertPromises.length) {
        await Promise.all(upsertPromises).catch(function(e) {
          throw new Error("No se pudieron guardar códigos en OC_Maximos: " + (e.message || e));
        });
      }
      artCount = Object.keys(_tallArtState.artsSelected).length;

    } else {
      // ─── Tallerista → Codigos X Tallerista + Articulos Virgilio X Tallerista ───
      var lineas = ["LK", "CH"];

      // a. Obtener o crear códigos en Codigos X Tallerista
      var codMap = _tallArtState.existingCodMap || {};
      var needCods = lineas.filter(function(l) { return !codMap[l]; });

      if (needCods.length) {
        // Buscar el máximo código numérico actual
        var allCods = await fetch(
          SUPABASE_URL + "/rest/v1/Codigos%20X%20Tallerista?select=Codigo",
          { headers: H }
        ).then(function(r) { return r.json(); }).catch(function() { return []; });
        var maxCod = 4000;
        (allCods || []).forEach(function(r) {
          var n = parseInt(r.Codigo, 10);
          if (!isNaN(n) && n > maxCod) maxCod = n;
        });

        var newCodRows = [];
        needCods.forEach(function(l) {
          maxCod++;
          codMap[l] = String(maxCod);
          newCodRows.push({ Nombre: nombre, Linea: l, Codigo: String(maxCod) });
        });

        var codRes = await fetch(SUPABASE_URL + "/rest/v1/Codigos%20X%20Tallerista", {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(newCodRows)
        });
        if (!codRes.ok) {
          var eCod = await codRes.text().catch(function() { return ""; });
          throw new Error("No se pudieron crear códigos de tallerista (HTTP " + codRes.status + ")" + (eCod ? ": " + eCod : ""));
        }
      }

      // b. Insertar artículos en Articulos Virgilio X Tallerista (1 por art × línea)
      var artRows = [];
      Object.keys(_tallArtState.artsSelected).forEach(function(artId) {
        var art = _tallArtState.artsSelected[artId];
        lineas.forEach(function(l) {
          if (codMap[l]) {
            artRows.push({
              Cod_Tallerista: codMap[l], Tallerista: nombre,
              Cod_Art: artId, Linea: l, Desc: art.desc || "?",
              Uni_x_Caja: art.uni || 1
            });
          }
        });
      });

      if (artRows.length) {
        var artRes2 = await fetch(SUPABASE_URL + "/rest/v1/Articulos%20Virgilio%20X%20Tallerista", {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(artRows)
        });
        if (!artRes2.ok) {
          var eArt = await artRes2.text().catch(function() { return ""; });
          throw new Error("No se pudieron guardar artículos (HTTP " + artRes2.status + ")" + (eArt ? ": " + eArt : ""));
        }
      }
      artCount = Object.keys(_tallArtState.artsSelected).length;
    }

    alert("✓ " + nombre + " agregado con " + artCount + " artículos.");
    tallArtClose();
    window.location.reload();
  } catch (e) {
    console.error("Error al guardar:", e);
    alert("Error al guardar: " + e.message);
  }
}

// Exponer globalmente
window.tallArtOpen = tallArtOpen;
window.tallArtClose = tallArtClose;
window.tallArtStep1Next = tallArtStep1Next;
window.tallArtStep2Back = tallArtStep2Back;
window.tallArtStep2Next = tallArtStep2Next;
window.tallArtStep2ToStep3 = tallArtStep2ToStep3;
window.tallArtStep3Back = tallArtStep3Back;
window.tallArtStep3Save = tallArtStep3Save;
window.tallArtFilterArts = tallArtFilterArts;
window.tallArtToggleArt = tallArtToggleArt;
window.tallArtLoadArts = tallArtLoadArts;
