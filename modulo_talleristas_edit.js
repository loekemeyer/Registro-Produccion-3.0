/* =========================================================
   MÓDULO: Editar Talleristas / Proveedores AT
   v2.0 — Cambiar nombre, teléfono, estado + asignar/editar códigos con % (OC_Maximos).

   Lógica igual a OCs Config:
   - Un código puede tener 1 o 2 proveedores
   - Si hay 1 prov: % = 100% en prov1, prov2 = null, % prov2 = 0%
   - Si hay 2 prov: % prov1 + % prov2 = 100%
   ========================================================= */

let _tallEditModal = null, _tallEditState = {};

async function tallEditInit() {
  if (!document.getElementById("tallEditModal")) {
    const modal = document.createElement("div");
    modal.id = "tallEditModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content tall-edit-modal">
        <div class="modal-header">
          <h2>✏️ Editar Tallerista / Proveedor AT</h2>
          <button onclick="tallEditClose()" class="modal-close">×</button>
        </div>
        <div class="modal-body">

          <!-- DATOS BÁSICOS -->
          <div id="tallEditStep1" class="tall-edit-step">
            <h3>Datos Básicos</h3>
            <div class="form-group">
              <label>Nombre:</label>
              <input id="tallEditNombre" type="text" class="form-input" readonly style="background:#f0f0f0;">
            </div>
            <div class="form-group">
              <label>Teléfono:</label>
              <input id="tallEditTelefono" type="text" placeholder="Ej: +54 9 11 1234-5678" class="form-input">
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="tallEditActivo"> Activo</label>
            </div>
            <button onclick="tallEditStep1Save()" class="btn-primary" style="margin-top:12px;">💾 Guardar Datos</button>
          </div>

          <!-- CÓDIGOS ASIGNADOS -->
          <div id="tallEditStep2" class="tall-edit-step" style="margin-top:24px;">
            <h3>Códigos Asignados (OC_Maximos)</h3>
            <p style="font-size:12px;color:#64748b;margin-bottom:12px;">
              Un código puede tener 1 o 2 proveedores. Los porcentajes deben sumar 100%.
            </p>

            <div class="form-group">
              <label>Buscar y agregar código:</label>
              <div style="display:flex;gap:8px;margin-bottom:12px;">
                <input id="tallEditCodSearch" type="text" placeholder="🔎 código o descripción..." class="form-input" style="flex:1;" oninput="tallEditFilterCods()">
                <button onclick="tallEditToggleCodList()" class="btn-primary" style="padding:6px 8px;font-size:11px;width:60px;white-space:nowrap;">Buscar</button>
              </div>
            </div>

            <div id="tallEditCodList" class="tall-edit-cod-list" style="max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin-bottom:16px;display:none;">
              <div class="loading">Cargando códigos...</div>
            </div>

            <div style="margin-top:16px;">
              <h4 style="margin-bottom:8px;">Códigos Actuales:</h4>
              <div id="tallEditCurrentCods" style="border:1px solid #e2e8f0;border-radius:6px;padding:8px;max-height:350px;overflow-y:auto;">
                <div class="loading">Cargando...</div>
              </div>
            </div>

            <button onclick="tallEditClose()" class="btn-secondary" style="margin-top:16px;">Cerrar</button>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(modal);
    _tallEditModal = modal;
  }

  if (!document.getElementById("tallEditStyles")) {
    const style = document.createElement("style");
    style.id = "tallEditStyles";
    style.textContent = `
      .tall-edit-modal { min-width: 550px; max-width: 700px; }
      .tall-edit-step { display: block; }
      .tall-edit-step.hidden { display: none; }
      .tall-edit-cod-list { border: 1px solid #e2e8f0; }
      .tall-edit-cod-item { padding: 10px; border-bottom: 1px solid #f0f0f0; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
      .tall-edit-cod-item:hover { background: #f9fafb; }
      .tall-edit-cod-item button { background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
      .tall-edit-cod-item button:hover { background: #2563eb; }
      .tall-edit-current-cod { padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; background: #fff; }
      .tall-edit-current-cod-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 600; }
      .tall-edit-current-cod-header button { background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
      .tall-edit-current-cod-header button:hover { background: #dc2626; }
      .tall-edit-prov-row { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; font-size: 13px; }
      .tall-edit-prov-row input { width: 60px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; }
      .tall-edit-prov-row .pct { font-weight: 600; }
      .tall-edit-prov-row .bad { color: #b91c1c; font-weight: 800; }
      .modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
      .modal.hidden { display: none; }
      .modal-content { background: white; border-radius: 8px; padding: 20px; max-height: 90vh; overflow-y: auto; }
      .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .modal-close { background: none; border: none; font-size: 24px; cursor: pointer; }
      .form-group { margin-bottom: 12px; }
      .form-group label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 13px; }
      .form-input { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; }
      .btn-primary { background: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
      .btn-primary:hover { background: #2563eb; }
      .btn-secondary { background: #e2e8f0; color: #1e293b; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
      .loading { text-align: center; padding: 16px; color: #64748b; }
      h4 { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0; }
    `;
    document.head.appendChild(style);
  }
}

async function tallEditOpen(nombre) {
  await tallEditInit();
  _tallEditState = { nombre: nombre, telefono: "", activo: true, allCods: [], currentCods: {} };

  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

  try {
    // 1. Cargar datos básicos de Tall_ProvAT_PS
    const tallRes = await fetch(
      SUPABASE_URL + "/rest/v1/Tall_ProvAT_PS?nombre=eq." + encodeURIComponent(nombre) + "&select=nombre,telefono,activo",
      { headers: H }
    );
    if (!tallRes.ok) throw new Error("Error cargando tallerista");
    const tallData = await tallRes.json();
    if (!tallData.length) { alert("Tallerista no encontrado."); return; }

    const tall = tallData[0];
    _tallEditState.nombre = tall.nombre;
    _tallEditState.telefono = tall.telefono || "";
    _tallEditState.activo = tall.activo;

    // 2. Cargar TODOS los códigos de OC_Maximos
    const allCodsRes = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?select=cod,descripcion,linea,uni_x_caja,proveedor,prop_prov1,proveedor2,prop_prov2,activo&order=cod.asc",
      { headers: H }
    );
    const allCods = await allCodsRes.json();
    _tallEditState.allCods = allCods || [];

    // 3. Cargar códigos asignados a ESTE tallerista
    const asignedRes = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?select=cod,descripcion,linea,uni_x_caja,proveedor,prop_prov1,proveedor2,prop_prov2",
      { headers: H }
    );
    const asigned = await asignedRes.json();
    _tallEditState.currentCods = {};
    (asigned || []).forEach(row => {
      const prov1 = String(row.proveedor || "").trim();
      const prov2 = String(row.proveedor2 || "").trim();
      if (prov1 === nombre || prov2 === nombre) {
        _tallEditState.currentCods[row.cod] = row;
      }
    });

    // 4. Llenar formulario
    document.getElementById("tallEditNombre").value = tall.nombre;
    document.getElementById("tallEditTelefono").value = _tallEditState.telefono;
    document.getElementById("tallEditActivo").checked = _tallEditState.activo;

    // 5. Mostrar modal
    document.getElementById("tallEditStep1").classList.remove("hidden");
    document.getElementById("tallEditStep2").classList.remove("hidden");
    tallEditRenderCurrentCods();

    _tallEditModal.classList.remove("hidden");
  } catch (e) {
    console.error("Error abriendo editor:", e);
    alert("Error al cargar tallerista: " + e.message);
  }
}

function tallEditClose() {
  if (_tallEditModal) _tallEditModal.classList.add("hidden");
  _tallEditState = {};
}

async function tallEditStep1Save() {
  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  const nombre = _tallEditState.nombre;
  const telefono = document.getElementById("tallEditTelefono").value.trim();
  const activo = document.getElementById("tallEditActivo").checked;

  try {
    const updateBody = { telefono: telefono || null, activo: activo };
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/Tall_ProvAT_PS?nombre=eq." + encodeURIComponent(nombre),
      {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(updateBody)
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    alert("✓ Datos guardados.");
    _tallEditState.telefono = telefono;
    _tallEditState.activo = activo;
  } catch (e) {
    console.error("Error al guardar:", e);
    alert("Error: " + e.message);
  }
}

function tallEditToggleCodList() {
  const list = document.getElementById("tallEditCodList");
  if (list.style.display === "none") {
    list.style.display = "block";
    tallEditFilterCods();
  } else {
    list.style.display = "none";
  }
}

function tallEditFilterCods() {
  const q = (document.getElementById("tallEditCodSearch").value || "").toLowerCase().trim();
  const allCods = _tallEditState.allCods || [];
  const currentCods = _tallEditState.currentCods || {};

  const filtered = allCods.filter(c => {
    if (currentCods[c.cod]) return false; // Ya asignado
    const cod = String(c.cod || "").toLowerCase();
    const desc = String(c.descripcion || "").toLowerCase();
    return q === "" || cod.includes(q) || desc.includes(q);
  });

  const listEl = document.getElementById("tallEditCodList");
  if (!filtered.length) {
    listEl.innerHTML = '<div class="loading">No se encontraron códigos disponibles.</div>';
    return;
  }

  let html = '';
  filtered.slice(0, 50).forEach(c => {
    html += '<div class="tall-edit-cod-item">' +
      '<span><b>' + escapeHtml(c.cod) + '</b> — ' + escapeHtml(c.descripcion || "?") + ' (' + (c.uni_x_caja || 1) + ' u/caja)</span>' +
      '<button onclick="tallEditAssignCod(\'' + c.cod + '\')">Asignar</button>' +
      '</div>';
  });
  listEl.innerHTML = html;
}

async function tallEditAssignCod(cod) {
  const nombre = _tallEditState.nombre;
  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

  try {
    // Obtener el código actual
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod) + "&select=*",
      { headers: H }
    );
    const rows = await res.json();
    if (!rows.length) throw new Error("Código no encontrado");

    const row = rows[0];
    const prov1 = String(row.proveedor || "").trim();
    const prov2 = String(row.proveedor2 || "").trim();

    // Lógica: si no tiene proveedor, asignar a prov1 (100%). Si tiene prov1, asignar a prov2 (50/50).
    let updateBody;
    if (!prov1) {
      updateBody = { proveedor: nombre, prop_prov1: 100 };
    } else if (!prov2) {
      updateBody = { proveedor2: nombre, prop_prov2: 50, prop_prov1: 50 };
    } else {
      alert("Este código ya tiene 2 proveedores. Quitá uno primero.");
      return;
    }

    const patchRes = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod),
      {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(updateBody)
      }
    );
    if (!patchRes.ok) throw new Error("HTTP " + patchRes.status);

    document.getElementById("tallEditCodSearch").value = "";
    await tallEditReloadCurrentCods();
    tallEditFilterCods();
  } catch (e) {
    console.error("Error asignando código:", e);
    alert("Error: " + e.message);
  }
}

async function tallEditReloadCurrentCods() {
  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  const nombre = _tallEditState.nombre;

  try {
    const asignedRes = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?select=cod,descripcion,linea,uni_x_caja,proveedor,prop_prov1,proveedor2,prop_prov2",
      { headers: H }
    );
    const asigned = await asignedRes.json();
    _tallEditState.currentCods = {};
    (asigned || []).forEach(row => {
      const prov1 = String(row.proveedor || "").trim();
      const prov2 = String(row.proveedor2 || "").trim();
      if (prov1 === nombre || prov2 === nombre) {
        _tallEditState.currentCods[row.cod] = row;
      }
    });
    tallEditRenderCurrentCods();
  } catch (e) {
    console.error("Error recargando códigos:", e);
  }
}

function tallEditRenderCurrentCods() {
  const contEl = document.getElementById("tallEditCurrentCods");
  const cods = Object.values(_tallEditState.currentCods || {});

  if (!cods.length) {
    contEl.innerHTML = '<div style="color:#999;text-align:center;padding:16px;">Sin códigos asignados.</div>';
    return;
  }

  const nombre = _tallEditState.nombre;
  let html = '';

  cods.forEach(row => {
    const cod = row.cod;
    const prov1 = String(row.proveedor || "").trim();
    const prov2 = String(row.proveedor2 || "").trim();
    const p1 = row.prop_prov1 || 100;
    const p2 = row.prop_prov2 || 0;
    const suma = p1 + (prov2 ? p2 : 0);
    const bad = Math.round(suma) !== 100;

    let provRows = '';

    // Proveedor 1
    if (prov1) {
      provRows += '<div class="tall-edit-prov-row">' +
        '<span style="flex:1;"><b>' + escapeHtml(prov1) + '</b></span>' +
        '<span class="pct' + (bad ? ' bad' : '') + '"><input type="number" min="0" max="100" step="1" value="' + p1 + '" onchange="tallEditUpdatePct(\'' + cod + '\', \'prov1\', this.value)"></span>' +
        '<span>%</span>' +
        (prov1 === nombre ? '<button onclick="tallEditRemoveProv(\'' + cod + '\', \'prov1\')">Quitar</button>' : '') +
        '</div>';
    }

    // Proveedor 2
    if (prov2) {
      provRows += '<div class="tall-edit-prov-row">' +
        '<span style="flex:1;"><b>' + escapeHtml(prov2) + '</b></span>' +
        '<span class="pct' + (bad ? ' bad' : '') + '"><input type="number" min="0" max="100" step="1" value="' + p2 + '" onchange="tallEditUpdatePct(\'' + cod + '\', \'prov2\', this.value)"></span>' +
        '<span>%</span>' +
        (prov2 === nombre ? '<button onclick="tallEditRemoveProv(\'' + cod + '\', \'prov2\')">Quitar</button>' : '') +
        '</div>';
    }

    html += '<div class="tall-edit-current-cod">' +
      '<div class="tall-edit-current-cod-header">' +
      '<span><b>' + escapeHtml(cod) + '</b> — ' + escapeHtml(row.descripcion || "?") + ' (' + (row.uni_x_caja || 1) + ' u/caja)</span>' +
      '</div>' +
      provRows +
      (bad ? '<div style="color:#b91c1c;font-weight:600;font-size:12px;margin-top:6px;">⚠ Los % deben sumar 100%</div>' : '') +
      '</div>';
  });

  contEl.innerHTML = html;
}

async function tallEditUpdatePct(cod, provPos, newVal) {
  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  const pct = Math.max(0, Math.min(100, parseFloat(newVal) || 0));

  try {
    const updateBody = provPos === "prov1" ? { prop_prov1: pct } : { prop_prov2: pct };
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod),
      {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(updateBody)
      }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    await tallEditReloadCurrentCods();
  } catch (e) {
    console.error("Error actualizando porcentaje:", e);
    alert("Error: " + e.message);
  }
}

async function tallEditRemoveProv(cod, provPos) {
  if (!confirm("¿Quitar este proveedor del código " + cod + "?")) return;

  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  const nombre = _tallEditState.nombre;

  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod) + "&select=proveedor,proveedor2,prop_prov1,prop_prov2",
      { headers: H }
    );
    const rows = await res.json();
    if (!rows.length) throw new Error("Código no encontrado");

    const row = rows[0];
    const prov1 = String(row.proveedor || "").trim();
    const prov2 = String(row.proveedor2 || "").trim();

    let updateBody;
    if (provPos === "prov1") {
      // Si quito prov1, muevo prov2 a prov1 si existe
      if (prov2) {
        updateBody = { proveedor: prov2, prop_prov1: 100, proveedor2: null, prop_prov2: 0 };
      } else {
        updateBody = { proveedor: null, prop_prov1: 0 };
      }
    } else {
      // Si quito prov2, prov1 sigue siendo 100
      updateBody = { proveedor2: null, prop_prov2: 0, prop_prov1: 100 };
    }

    const patchRes = await fetch(
      SUPABASE_URL + "/rest/v1/OC_Maximos?cod=eq." + encodeURIComponent(cod),
      {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(updateBody)
      }
    );
    if (!patchRes.ok) throw new Error("HTTP " + patchRes.status);
    await tallEditReloadCurrentCods();
  } catch (e) {
    console.error("Error quitando proveedor:", e);
    alert("Error: " + e.message);
  }
}

// Exponer globalmente
window.tallEditOpen = tallEditOpen;
window.tallEditClose = tallEditClose;
window.tallEditStep1Save = tallEditStep1Save;
window.tallEditToggleCodList = tallEditToggleCodList;
window.tallEditFilterCods = tallEditFilterCods;
window.tallEditAssignCod = tallEditAssignCod;
window.tallEditReloadCurrentCods = tallEditReloadCurrentCods;
window.tallEditRenderCurrentCods = tallEditRenderCurrentCods;
window.tallEditUpdatePct = tallEditUpdatePct;
window.tallEditRemoveProv = tallEditRemoveProv;
