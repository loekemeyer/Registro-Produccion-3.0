import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

// Nada de esto va hardcodeado: el Phone ID, el token de Meta, los destinatarios y
// el token que autoriza la invocacion se leen de lecturacvs.server_secrets via la
// RPC public.server_secret, que solo puede ejecutar service_role. Para rotar el
// token o cambiar un numero se toca esa tabla; la funcion no se vuelve a deployar.
// Los valores de abajo son solo red de seguridad por si falla la lectura.
const WA_PHONE_ID_FALLBACK = "918089688061759";
const DEST_PROD_FALLBACK = ["5491162521635", "5491131181594", "5491131181027"];
const DEST_TEST_FALLBACK = ["5491156517686"];

// Vigencia de la URL firmada del PDF: 3 dias, lo mismo que retiene el cron
// limpiar-reportes-viejos. El destinatario no depende de ella: WhatsApp baja el
// archivo y lo deja adjunto en el chat. La firma solo evita que el PDF, que es
// nominal, quede servido a cualquiera que adivine el nombre.
const URL_FIRMADA_SEG = 3 * 24 * 3600;

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const JORNADA_SEG = 9 * 3600;
const DAVID_LEGAJO = "233";
const EDUARDO_LEGAJO = "19";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

async function leerSecret(sb: any, clave: string, fallback?: string): Promise<string> {
  try {
    const { data, error } = await sb.rpc("server_secret", { p_k: clave });
    if (!error && data) return String(data);
    if (error) console.error(`server_secret(${clave}):`, error.message);
  } catch (err) {
    console.error(`server_secret(${clave}):`, String(err));
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Falta el secreto ${clave} en lecturacvs.server_secrets`);
}

async function leerLista(sb: any, clave: string, fallback: string[]): Promise<string[]> {
  try {
    const crudo = await leerSecret(sb, clave, "");
    if (crudo) {
      const arr = JSON.parse(crudo);
      if (Array.isArray(arr) && arr.length) return arr.map((n: any) => String(n).trim()).filter(Boolean);
    }
  } catch (err) {
    console.error(`lista ${clave} ilegible:`, String(err));
  }
  return fallback;
}

function esMatriz(mat: string): boolean { return /^\d+\w*$/.test(mat.trim()); }
function esTM(mat: string): boolean { const m = mat.trim(); return m !== "" && !esMatriz(m) && !["RM", "PM", "RD", "LT", "E"].includes(m); }
function esPiedra(mat: string): boolean { return mat.trim() === "501"; }
function esCM(r: any): boolean { return String(r?.Nombre_Matriz || "").trim().toLowerCase().startsWith("cambiar matriz"); }
function destinoCM(r: any): string {
  const m = String(r?.Nombre_Matriz || "").match(/cambiar matriz a (\S+)/i);
  if (m) return m[1];
  const mat = String(r?.Matriz || "").trim();
  return mat && mat !== "CM" ? mat : "-";
}
function nm(v: any): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function argNow(): Date { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })); }
function fmtDate(d: Date): string { return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
function fmtTime(d: Date): string { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function fmtHsMin(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (h === 0) return `${m}Min`;
  return `${h}Hs ${String(m).padStart(2, "0")}Min`;
}
function sortMatriz(a: string, b: string): number {
  const na = parseInt(a, 10); const nb = parseInt(b, 10);
  const va = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  if (va !== vb) return va - vb;
  return a.localeCompare(b, "es");
}
// Devuelve los ultimos N dias laborables (Lunes-Viernes) anteriores a una fecha base (excluyendola)
function ultimosNLaborables(baseAR: Date, n: number): { dia: number; mes: number; anio: number }[] {
  const out: { dia: number; mes: number; anio: number }[] = [];
  const d = new Date(baseAR);
  d.setDate(d.getDate() - 1);
  while (out.length < n) {
    const dow = d.getDay(); // 0 = Domingo, 6 = Sabado
    if (dow !== 0 && dow !== 6) {
      out.push({ dia: d.getDate(), mes: d.getMonth() + 1, anio: d.getFullYear() });
    }
    d.setDate(d.getDate() - 1);
  }
  return out;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type EduardoMat = { matriz: string; nombre: string; prom: number; segXUni: number; premio: number | null };
type TMEntry = { nombre: string; seg: number };
type AusenteEntry = { nombre: string; legajo: string; diasActivos: number };

function drawPage(
  doc: any, titulo: string, pageNum: number, totalPages: number,
  matrices: string[], empleadosSlice: string[],
  matMap: Map<string, any>, empMap: Map<string, any>,
  dataMap: Map<string, { segTrab: number; uni: number; segHist: number }>,
  hsTotalByEmp: Map<string, number>,
  puntajeByEmp: Map<string, number | null>,
  tmByTypeByEmp: Map<string, Map<string, number>>,
  tmTypes: string[], tmNombres: Map<string, string>,
  piedraEmps: string[], showPiedra: boolean,
  davidCMs: { destino: string; seg: number }[],
  davidOtrosTM: TMEntry[],
  eduardoMats: EduardoMat[],
  eduardoTMs: TMEntry[],
  ausentes: AusenteEntry[]
) {
  const pageW = 297, pageH = 210, marginL = 8, marginT = 8;
  const fontSize = 10, headerFontSize = 9, subHeaderFontSize = 8;
  const labelFontSize = fontSize + 2;
  const colN = 12, colMatriz = 55, colSegProm = 10;
  const fixedW = colN + colMatriz + colSegProm;
  const colEmpSingle = 10, colEmpPair = colEmpSingle * 2;
  const tableW = fixedW + colEmpPair * empleadosSlice.length;
  const rowH = 7, tmRowH = 7;
  const headerH1 = 9, headerH2 = 6, headerH = headerH1 + headerH2;

  const pGap = 3, pColNombre = 20, pColKG = 11, pColPtje = 10;
  const pTableW = pColNombre + pColKG + pColPtje;
  const pX = marginL + tableW + pGap;
  const hasPiedra = showPiedra && piedraEmps.length > 0;
  const davidHasData = davidCMs.length > 0 || davidOtrosTM.length > 0;
  const eduardoHasData = eduardoMats.length > 0 || eduardoTMs.length > 0;
  const hasAusentes = ausentes.length > 0;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(titulo, marginL, marginT + 5);
  if (totalPages > 1) { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text(`Pagina ${pageNum} de ${totalPages}`, pageW - marginL, marginT + 5, { align: "right" }); }

  let y = marginT + 10;
  const tableStartY = y;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(headerFontSize); doc.setFont("helvetica", "bold");
  doc.text("N", marginL + colN / 2, y + headerH / 2 + 1, { align: "center" });
  doc.text("Matriz", marginL + colN + colMatriz / 2, y + headerH / 2 + 1, { align: "center" });
  doc.setFontSize(7);
  doc.text("Seg", marginL + colN + colMatriz + colSegProm / 2, y + headerH / 2 - 1, { align: "center" });
  doc.text("Prom", marginL + colN + colMatriz + colSegProm / 2, y + headerH / 2 + 3, { align: "center" });

  let x = marginL + fixedW;
  empleadosSlice.forEach((leg) => {
    const nombre = empMap.get(leg)?.Empleado || leg; const parts = nombre.trim().split(/\s+/);
    doc.setFontSize(headerFontSize); doc.setFont("helvetica", "bold");
    doc.text(parts[0] || "", x + colEmpPair / 2, y + 4, { align: "center" });
    if (parts.length > 1) { doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.text(parts.slice(1).join(" ").substring(0, 14), x + colEmpPair / 2, y + 7.5, { align: "center" }); }
    doc.setFontSize(subHeaderFontSize); doc.setFont("helvetica", "bold");
    doc.text("Seg", x + colEmpSingle / 2, y + headerH - 1.5, { align: "center" });
    doc.text("Ptje", x + colEmpSingle + colEmpSingle / 2, y + headerH - 1.5, { align: "center" });
    x += colEmpPair;
  });
  doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.1);
  doc.line(marginL + fixedW, y + headerH1, marginL + tableW, y + headerH1);
  doc.line(marginL + colN, y, marginL + colN, y + headerH); doc.line(marginL + colN + colMatriz, y, marginL + colN + colMatriz, y + headerH); doc.line(marginL + fixedW, y, marginL + fixedW, y + headerH);
  x = marginL + fixedW; empleadosSlice.forEach(() => { doc.line(x, y, x, y + headerH); doc.line(x + colEmpSingle, y + headerH1, x + colEmpSingle, y + headerH); x += colEmpPair; });
  y += headerH;

  doc.setTextColor(0, 0, 0); const rowYPositions: number[] = [];
  matrices.forEach((mat) => {
    if (y + rowH > pageH - 16) {
      doc.addPage(); y = marginT + 5;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text("N", marginL + colN / 2, y + 4, { align: "center" });
      doc.text("Matriz", marginL + colN + colMatriz / 2, y + 4, { align: "center" });
      doc.text("Seg P", marginL + colN + colMatriz + colSegProm / 2, y + 4, { align: "center" });
      let hx = marginL + fixedW;
      empleadosSlice.forEach((leg) => { doc.text((empMap.get(leg)?.Empleado || leg).trim().split(/\s+/)[0] || "", hx + colEmpPair / 2, y + 4, { align: "center" }); hx += colEmpPair; });
      y += 6;
    }
    rowYPositions.push(y);
    const info = matMap.get(mat); const nombre = info?.Matriz || ""; const tHist = nm(info?.Tiempo_Historico);
    doc.setFontSize(fontSize); doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
    doc.text(mat, marginL + colN / 2, y + rowH / 2 + 1, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize - 1);
    doc.text(nombre.substring(0, 35), marginL + colN + 2, y + rowH / 2 + 1);
    doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
    doc.text(tHist > 0 ? tHist.toFixed(1) : "", marginL + colN + colMatriz + colSegProm / 2, y + rowH / 2 + 1, { align: "center" });
    let cx = marginL + fixedW;
    empleadosSlice.forEach((leg) => {
      const g = dataMap.get(`${mat}__${leg}`);
      if (g && g.uni > 0) {
        const segXUni = g.segTrab / g.uni;
        doc.setFontSize(fontSize); doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
        if (tHist > 0) {
          doc.text(segXUni.toFixed(1), cx + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
          const premio = (-(segXUni / tHist - 1)) * 10;
          doc.setFont("helvetica", "bold");
          doc.text(premio.toFixed(1), cx + colEmpSingle + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
        } else {
          doc.text(segXUni.toFixed(1), cx + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
          doc.setFont("helvetica", "bold");
          doc.text("-", cx + colEmpSingle + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
        }
      }
      cx += colEmpPair;
    });
    y += rowH;
  });

  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.15);
  for (let i = 1; i < rowYPositions.length; i++) { doc.line(marginL, rowYPositions[i], marginL + tableW, rowYPositions[i]); }

  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
  doc.rect(marginL, tableStartY, tableW, y - tableStartY);

  doc.setLineWidth(0.3);
  doc.line(marginL + colN, tableStartY, marginL + colN, y); doc.line(marginL + colN + colMatriz, tableStartY, marginL + colN + colMatriz, y); doc.line(marginL + fixedW, tableStartY, marginL + fixedW, y);
  doc.setLineWidth(0.2); let vx = marginL + fixedW;
  empleadosSlice.forEach(() => { doc.line(vx, tableStartY, vx, y); doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.1); doc.line(vx + colEmpSingle, tableStartY + headerH, vx + colEmpSingle, y); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2); vx += colEmpPair; });

  const sumRowH = 7;
  const drawSumRow = (label: string, startY: number, getValue: (leg: string) => string) => {
    doc.setTextColor(0, 0, 0); doc.setFontSize(labelFontSize); doc.setFont("helvetica", "bold");
    doc.text(label, marginL + colN + 2, startY + sumRowH / 2 + 1.5);
    let cx = marginL + fixedW;
    empleadosSlice.forEach((leg) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
      doc.text(getValue(leg), cx + colEmpPair / 2, startY + sumRowH / 2 + 1.5, { align: "center" });
      cx += colEmpPair;
    });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.rect(marginL, startY, tableW, sumRowH);
    doc.setLineWidth(0.3); doc.line(marginL + colN, startY, marginL + colN, startY + sumRowH); doc.line(marginL + colN + colMatriz, startY, marginL + colN + colMatriz, startY + sumRowH); doc.line(marginL + fixedW, startY, marginL + fixedW, startY + sumRowH);
    doc.setLineWidth(0.2); let svx = marginL + fixedW;
    empleadosSlice.forEach(() => { doc.line(svx, startY, svx, startY + sumRowH); svx += colEmpPair; });
  };

  drawSumRow("Puntaje Diario", y, (leg) => {
    const p = puntajeByEmp.get(leg);
    return p === null || p === undefined ? "-" : p.toFixed(1);
  });
  y += sumRowH;

  drawSumRow("Hs Total Trabajadas", y, (leg) => fmtHsMin(hsTotalByEmp.get(leg) || 0));
  y += sumRowH;

  drawSumRow("Total Tiempos Muertos", y, (leg) => {
    const empTm = tmByTypeByEmp.get(leg); let totalSeg = 0;
    if (empTm) empTm.forEach((seg) => { totalSeg += seg; });
    return totalSeg > 0 ? fmtHsMin(totalSeg) : "-";
  });
  y += sumRowH;

  drawSumRow("Hs Totales Del Dia", y, (leg) => {
    const hsTrab = hsTotalByEmp.get(leg) || 0;
    const empTm = tmByTypeByEmp.get(leg); let hsTm = 0;
    if (empTm) empTm.forEach((seg) => { hsTm += seg; });
    return fmtHsMin(hsTrab + hsTm);
  });
  y += sumRowH;

  drawSumRow("Hs Faltantes", y, (leg) => {
    const hsTrab = hsTotalByEmp.get(leg) || 0;
    const empTm = tmByTypeByEmp.get(leg); let hsTm = 0;
    if (empTm) empTm.forEach((seg) => { hsTm += seg; });
    const totalDia = hsTrab + hsTm;
    if (totalDia >= JORNADA_SEG) return "COMPLETO";
    return fmtHsMin(JORNADA_SEG - totalDia);
  });
  y += sumRowH;

  if (tmTypes.length > 0) {
    let tmY = y + 4;
    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Tiempos Muertos del Dia", marginL, tmY + 3);
    tmY += 5;
    const tmStartY = tmY;
    tmTypes.forEach((tipo) => {
      const nombreTM = tmNombres.get(tipo) || tipo;
      doc.setTextColor(0, 0, 0); doc.setFontSize(labelFontSize); doc.setFont("helvetica", "bold");
      doc.text(nombreTM.substring(0, 25), marginL + colN + 2, tmY + tmRowH / 2 + 1);
      let cx3 = marginL + fixedW;
      empleadosSlice.forEach((leg) => {
        const empTm = tmByTypeByEmp.get(leg);
        const seg = empTm ? (empTm.get(tipo) || 0) : 0;
        doc.setTextColor(0, 0, 0); doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
        doc.text(seg > 0 ? fmtHsMin(seg) : "-", cx3 + colEmpPair / 2, tmY + tmRowH / 2 + 1, { align: "center" });
        cx3 += colEmpPair;
      });
      tmY += tmRowH;
    });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.rect(marginL, tmStartY, tableW, tmY - tmStartY);
    doc.setLineWidth(0.2);
    doc.line(marginL + colN, tmStartY, marginL + colN, tmY);
    doc.line(marginL + colN + colMatriz, tmStartY, marginL + colN + colMatriz, tmY);
    doc.line(marginL + fixedW, tmStartY, marginL + fixedW, tmY);
    vx = marginL + fixedW;
    empleadosSlice.forEach(() => { doc.line(vx, tmStartY, vx, tmY); vx += colEmpPair; });
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let tmLineY = tmStartY;
    for (let i = 0; i < tmTypes.length - 1; i++) { tmLineY += tmRowH; doc.line(marginL, tmLineY, marginL + tableW, tmLineY); }
  }

  let rightY = tableStartY;
  if (hasPiedra) {
    let pY = tableStartY;
    const tHist501 = nm(matMap.get("501")?.Tiempo_Historico);
    const pHeaderH = 8, pSubH = 6, pRowH = 7;

    doc.setTextColor(0, 0, 0); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("Piedra", pX + pTableW / 2, pY + pHeaderH / 2 + 1, { align: "center" });
    pY += pHeaderH;

    doc.setTextColor(0, 0, 0); doc.setFontSize(6); doc.setFont("helvetica", "bold");
    doc.text("Empleado", pX + pColNombre / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.text("KG(Uni)", pX + pColNombre + pColKG / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.text("Ptje", pX + pColNombre + pColKG + pColPtje / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.1);
    doc.line(pX + pColNombre, pY, pX + pColNombre, pY + pSubH);
    doc.line(pX + pColNombre + pColKG, pY, pX + pColNombre + pColKG, pY + pSubH);
    pY += pSubH;

    const pDataStartY = pY;
    piedraEmps.forEach((leg) => {
      const nombreFull = (empMap.get(leg)?.Empleado || leg).trim();
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(nombreFull.substring(0, 12), pX + 1.5, pY + pRowH / 2 + 1);

      const g = dataMap.get(`501__${leg}`);
      if (g && g.uni > 0) {
        doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "normal");
        doc.text(String(g.uni), pX + pColNombre + pColKG / 2, pY + pRowH / 2 + 1, { align: "center" });

        const segXUni = g.segTrab / g.uni;
        const premio = tHist501 > 0 ? (-(segXUni / tHist501 - 1)) * 10 : 0;
        doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold");
        doc.text(premio.toFixed(1), pX + pColNombre + pColKG + pColPtje / 2, pY + pRowH / 2 + 1, { align: "center" });
      }
      pY += pRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let pLineY = pDataStartY;
    for (let i = 0; i < piedraEmps.length - 1; i++) { pLineY += pRowH; doc.line(pX, pLineY, pX + pTableW, pLineY); }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
    doc.line(pX + pColNombre, pDataStartY, pX + pColNombre, pY);
    doc.line(pX + pColNombre + pColKG, pDataStartY, pX + pColNombre + pColKG, pY);

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, tableStartY, pTableW, pY - tableStartY);
    doc.setLineWidth(0.3);
    doc.line(pX, tableStartY + pHeaderH, pX + pTableW, tableStartY + pHeaderH);
    doc.line(pX, tableStartY + pHeaderH + pSubH, pX + pTableW, tableStartY + pHeaderH + pSubH);
    rightY = pY;
  }

  if (showPiedra && davidHasData) {
    let dY = rightY + (hasPiedra ? 3 : 0);
    const dHeaderH = 7, dRowH = 5.5;
    const dBoxStart = dY;

    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("David - Detalle", pX + pTableW / 2, dY + dHeaderH / 2 + 1, { align: "center" });
    dY += dHeaderH;

    const dDataStartY = dY;

    davidCMs.forEach((cm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(`Cambie matriz ${cm.destino}`.substring(0, 22), pX + 1.5, dY + dRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(fmtHsMin(cm.seg), pX + pTableW - 1.5, dY + dRowH / 2 + 1.2, { align: "right" });
      dY += dRowH;
    });

    if (davidCMs.length > 0 && davidOtrosTM.length > 0) {
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
      doc.line(pX, dY, pX + pTableW, dY);
    }

    davidOtrosTM.forEach((tm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text((tm.nombre || "").substring(0, 22), pX + 1.5, dY + dRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(fmtHsMin(tm.seg), pX + pTableW - 1.5, dY + dRowH / 2 + 1.2, { align: "right" });
      dY += dRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let dLineY = dDataStartY;
    const totalDRows = davidCMs.length + davidOtrosTM.length;
    for (let i = 0; i < totalDRows - 1; i++) {
      dLineY += dRowH;
      if (i === davidCMs.length - 1 && davidOtrosTM.length > 0) continue;
      doc.line(pX, dLineY, pX + pTableW, dLineY);
    }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, dBoxStart, pTableW, dY - dBoxStart);
    doc.setLineWidth(0.3);
    doc.line(pX, dBoxStart + dHeaderH, pX + pTableW, dBoxStart + dHeaderH);
    rightY = dY;
  }

  if (showPiedra && eduardoHasData) {
    const eColN = 7, eColDesc = 15, eColProm = 8, eColPtje = pTableW - eColN - eColDesc - eColProm;
    const eHeaderH = 7, eSubH = 5, eRowH = 5.5;
    let eY = rightY + ((hasPiedra || davidHasData) ? 3 : 0);
    const eBoxStart = eY;

    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Eduardo - Detalle", pX + pTableW / 2, eY + eHeaderH / 2 + 1, { align: "center" });
    eY += eHeaderH;

    doc.setTextColor(0, 0, 0); doc.setFontSize(6); doc.setFont("helvetica", "bold");
    doc.text("N", pX + eColN / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Desc", pX + eColN + eColDesc / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Prom", pX + eColN + eColDesc + eColProm / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Ptje", pX + eColN + eColDesc + eColProm + eColPtje / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.1);
    doc.line(pX + eColN, eY, pX + eColN, eY + eSubH);
    doc.line(pX + eColN + eColDesc, eY, pX + eColN + eColDesc, eY + eSubH);
    doc.line(pX + eColN + eColDesc + eColProm, eY, pX + eColN + eColDesc + eColProm, eY + eSubH);
    eY += eSubH;

    const eDataStartY = eY;

    eduardoMats.forEach((em) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(em.matriz, pX + eColN / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6);
      doc.text((em.nombre || "").substring(0, 11), pX + eColN + 1, eY + eRowH / 2 + 1.2);
      doc.setFontSize(7);
      doc.text(em.prom > 0 ? em.prom.toFixed(1) : "", pX + eColN + eColDesc + eColProm / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(em.premio === null ? "-" : em.premio.toFixed(1), pX + eColN + eColDesc + eColProm + eColPtje / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      eY += eRowH;
    });

    if (eduardoMats.length > 0 && eduardoTMs.length > 0) {
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
      doc.line(pX, eY, pX + pTableW, eY);
    }

    eduardoTMs.forEach((tm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text((tm.nombre || "").substring(0, 22), pX + 1.5, eY + eRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(fmtHsMin(tm.seg), pX + pTableW - 1.5, eY + eRowH / 2 + 1.2, { align: "right" });
      eY += eRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let eLineY = eDataStartY;
    const totalERows = eduardoMats.length + eduardoTMs.length;
    for (let i = 0; i < totalERows - 1; i++) {
      eLineY += eRowH;
      if (i === eduardoMats.length - 1 && eduardoTMs.length > 0) continue;
      doc.line(pX, eLineY, pX + pTableW, eLineY);
    }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
    const matricesEndY = eDataStartY + eduardoMats.length * eRowH;
    doc.line(pX + eColN, eDataStartY, pX + eColN, matricesEndY);
    doc.line(pX + eColN + eColDesc, eDataStartY, pX + eColN + eColDesc, matricesEndY);
    doc.line(pX + eColN + eColDesc + eColProm, eDataStartY, pX + eColN + eColDesc + eColProm, matricesEndY);

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, eBoxStart, pTableW, eY - eBoxStart);
    doc.setLineWidth(0.3);
    doc.line(pX, eBoxStart + eHeaderH, pX + pTableW, eBoxStart + eHeaderH);
    doc.line(pX, eBoxStart + eHeaderH + eSubH, pX + pTableW, eBoxStart + eHeaderH + eSubH);
    rightY = eY;
  }

  // ===== OPERARIOS AUSENTES (debajo de los anteriores, solo si hay datos) =====
  if (showPiedra && hasAusentes) {
    const aHeaderH = 7, aRowH = 5.5;
    let aY = rightY + ((hasPiedra || davidHasData || eduardoHasData) ? 3 : 0);
    const aBoxStart = aY;

    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Operarios Ausentes", pX + pTableW / 2, aY + aHeaderH / 2 + 1, { align: "center" });
    aY += aHeaderH;

    const aDataStartY = aY;
    ausentes.forEach((a) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text((a.nombre || "").substring(0, 22), pX + 1.5, aY + aRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(`${a.diasActivos}/4d`, pX + pTableW - 1.5, aY + aRowH / 2 + 1.2, { align: "right" });
      aY += aRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let aLineY = aDataStartY;
    for (let i = 0; i < ausentes.length - 1; i++) {
      aLineY += aRowH;
      doc.line(pX, aLineY, pX + pTableW, aLineY);
    }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, aBoxStart, pTableW, aY - aBoxStart);
    doc.setLineWidth(0.3);
    doc.line(pX, aBoxStart + aHeaderH, pX + pTableW, aBoxStart + aHeaderH);
    rightY = aY;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    let body: any = null;
    let test = false; let fechaOverride: string | null = null;
    try { body = await req.json(); test = body?.test === true; if (body?.fecha) fechaOverride = body.fecha; } catch { /* */ }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); const ahora = argNow();

    // ===== AUTORIZACION =====
    // verify_jwt esta en false porque la dispara pg_net desde el cron, que no manda JWT.
    // La puerta la hace este token: sin el, la funcion no genera el PDF ni devuelve
    // la URL firmada. Antes cualquiera con la URL se llevaba el reporte nominal entero.
    let tokenRecibido = "";
    try { tokenRecibido = new URL(req.url).searchParams.get("token") || ""; } catch { /* */ }
    if (!tokenRecibido) tokenRecibido = String(body?.token || "");
    const tokenEsperado = await leerSecret(sb, "REPORTES_TRIGGER_TOKEN");
    if (tokenRecibido !== tokenEsperado) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const WA_TOKEN = await leerSecret(sb, "REPORTES_WA_TOKEN");
    const WA_PHONE_ID = await leerSecret(sb, "REPORTES_WA_PHONE_ID", WA_PHONE_ID_FALLBACK);
    const nums = test
      ? await leerLista(sb, "REPORTES_WA_DEST_TEST", DEST_TEST_FALLBACK)
      : await leerLista(sb, "REPORTES_WA_DEST_PROD", DEST_PROD_FALLBACK);
    const hoy = fechaOverride || `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,"0")}-${String(ahora.getDate()).padStart(2,"0")}`;
    const { data: matricesData } = await sb.from("Matrices").select("N_Matriz, Matriz, Tiempo_Historico");
    const { data: empleadosData } = await sb.from("Empleados").select("Legajo, Empleado, Activo");
    if (!matricesData || !empleadosData) throw new Error("No se pudieron cargar datos maestros");
    const matMap = new Map<string, any>(); matricesData.forEach((m: any) => matMap.set(String(m.N_Matriz || "").trim(), m));
    const empMap = new Map<string, any>(); empleadosData.forEach((e: any) => empMap.set(String(e.Legajo || "").trim(), e));
    // Registro Producción 3.0 graba el legajo VERDADERO (c19 = CHEF SRL); Empleados lo tiene sin la letra. El nombre de los de 3.0
    // sale de reg_prod_3_0.operario, así el reporte sigue mostrando el nombre [Elías, 09/10: «el reporte pone el nombre, que siga así»].
    // El recuadro «Eduardo» es el del ALIMENTADOR (permiso en reg_prod_3_0.operario_permiso), no el legajo «19» escrito acá.
    const alimentadores = new Set<string>([EDUARDO_LEGAJO]);
    try {
      const { data: ops } = await sb.schema("reg_prod_3_0").from("operario").select("legajo, nombre");
      (ops || []).forEach((o: any) => { const k = String(o.legajo || "").trim(); if (k && !empMap.has(k)) empMap.set(k, { Legajo: k, Empleado: o.nombre, Activo: "SI" }); });
      const { data: perms } = await sb.schema("reg_prod_3_0").from("operario_permiso").select("legajo").eq("es_alimentador", true);
      (perms || []).forEach((x: any) => { const k = String(x.legajo || "").trim(); if (k) alimentadores.add(k); });
    } catch (err) { console.error("operarios 3.0:", String(err)); }
    const esEduardo = (leg: string) => alimentadores.has(leg);
    const sinLetra = (leg: string) => leg.replace(/^c/i, "");
    // Registro Producción 2.0 + 3.0 (09/10/2026, Elías: «que de momento lean todas»): la vista reg_prod_3_0.espejo_todas junta
    // public.db_n8n_espejo (2.0) y reg_prod_3_0.procesado_cervantes (3.0) con los mismos nombres de columna.
    const espejo = () => sb.schema("reg_prod_3_0").from("espejo_todas");
    const allRegs: any[] = []; const PAGE = 1000; let from = 0;
    while (true) { const { data } = await espejo().select("Matriz, Nombre_Matriz, Uni, Segundos_Trabajados, Segundos_Historico, Anular_Tiempo, Eliminar, Legajo, Fecha, Hora_Inicio").gte("Fecha", hoy + "T00:00:00").lte("Fecha", hoy + "T23:59:59").or("Eliminar.is.null,Eliminar.neq.S").range(from, from + PAGE - 1); if (!data || !data.length) break; allRegs.push(...data); if (data.length < PAGE) break; from += PAGE; }

    const esExcluido = (leg: string) => leg === "1" || leg === DAVID_LEGAJO || esEduardo(leg);
    const cajones = allRegs.filter((r: any) => { const mat = String(r.Matriz || "").trim(); const leg = String(r.Legajo || "").trim(); return !esCM(r) && esMatriz(mat) && !esPiedra(mat) && nm(r.Uni) > 0 && !esExcluido(leg); });
    const piedraRegs = allRegs.filter((r: any) => { const mat = String(r.Matriz || "").trim(); return esPiedra(mat) && nm(r.Uni) > 0 && String(r.Legajo || "").trim() !== "1"; });
    const tmEntries = allRegs.filter((r: any) => { const leg = String(r.Legajo || "").trim(); if (esExcluido(leg)) return false; if (nm(r.Segundos_Trabajados) <= 0) return false; if (esCM(r)) return true; const mat = String(r.Matriz || "").trim(); return esTM(mat); });

    const piedraEmpSet = new Set<string>();
    piedraRegs.forEach((r: any) => { piedraEmpSet.add(String(r.Legajo || "").trim()); });

    const empSetU = new Set<string>(); const matSetU = new Set<string>();
    cajones.forEach((r: any) => { const leg = String(r.Legajo || "").trim(); if (!piedraEmpSet.has(leg)) empSetU.add(leg); matSetU.add(String(r.Matriz || "").trim()); });
    tmEntries.forEach((r: any) => { const leg = String(r.Legajo || "").trim(); if (!piedraEmpSet.has(leg)) empSetU.add(leg); });

    const empleados = [...empSetU].sort((a, b) => (empMap.get(a)?.Empleado || a).localeCompare(empMap.get(b)?.Empleado || b, "es"));
    const matrices = [...matSetU].sort(sortMatriz);
    const piedraEmps = [...piedraEmpSet].sort((a, b) => (empMap.get(a)?.Empleado || a).localeCompare(empMap.get(b)?.Empleado || b, "es"));

    const dataMap = new Map<string, { segTrab: number; uni: number; segHist: number }>();
    [...cajones, ...piedraRegs].forEach((r: any) => { const mat = String(r.Matriz || "").trim(); const leg = String(r.Legajo || "").trim(); const key = `${mat}__${leg}`; if (!dataMap.has(key)) dataMap.set(key, { segTrab: 0, uni: 0, segHist: 0 }); const g = dataMap.get(key)!; g.segTrab += nm(r.Segundos_Trabajados); g.uni += nm(r.Uni); g.segHist += nm(r.Segundos_Historico); });

    const hsTotalByEmp = new Map<string, number>(); empleados.forEach(leg => { let total = 0; matrices.forEach(mat => { const g = dataMap.get(`${mat}__${leg}`); if (g) total += g.segTrab; }); hsTotalByEmp.set(leg, total); });

    const puntajeByEmp = new Map<string, number | null>();
    empleados.forEach(leg => {
      let sumT = 0; let sumH = 0;
      matrices.forEach(mat => {
        const tp = nm(matMap.get(mat)?.Tiempo_Historico);
        if (tp <= 0) return;
        const g = dataMap.get(`${mat}__${leg}`);
        if (!g) return;
        sumT += g.segTrab;
        sumH += tp * g.uni;
      });
      puntajeByEmp.set(leg, sumH > 0 ? (-(sumT / sumH - 1)) * 10 : null);
    });

    const tmByTypeByEmp = new Map<string, Map<string, number>>(); const tmTypeSet = new Set<string>();
    const tmNombres = new Map<string, string>();
    tmEntries.forEach((r: any) => {
      const leg = String(r.Legajo || "").trim();
      if (piedraEmpSet.has(leg)) return;
      if (esCM(r)) return;
      const tipo = String(r.Matriz || "").trim();
      tmTypeSet.add(tipo);
      if (!tmNombres.has(tipo)) { const nm2 = String(r.Nombre_Matriz || "").trim(); if (nm2) tmNombres.set(tipo, nm2); }
      if (!tmByTypeByEmp.has(leg)) tmByTypeByEmp.set(leg, new Map());
      const empTm = tmByTypeByEmp.get(leg)!;
      empTm.set(tipo, (empTm.get(tipo) || 0) + nm(r.Segundos_Trabajados));
    });
    const tmTypeTotals = new Map<string, number>();
    tmEntries.forEach((r: any) => {
      const leg = String(r.Legajo || "").trim();
      if (piedraEmpSet.has(leg)) return;
      if (esCM(r)) return;
      const tipo = String(r.Matriz || "").trim();
      tmTypeTotals.set(tipo, (tmTypeTotals.get(tipo) || 0) + nm(r.Segundos_Trabajados));
    });
    const tmTypes = [...tmTypeSet].sort((a, b) => (tmTypeTotals.get(b) || 0) - (tmTypeTotals.get(a) || 0));

    const davidCMs: { destino: string; seg: number; horaInicio: string }[] = [];
    const davidOtrosMap = new Map<string, { nombre: string; seg: number }>();
    allRegs.forEach((r: any) => {
      const leg = String(r.Legajo || "").trim();
      if (leg !== DAVID_LEGAJO) return;
      const seg = nm(r.Segundos_Trabajados);
      if (seg <= 0) return;
      if (esCM(r)) {
        davidCMs.push({ destino: destinoCM(r), seg, horaInicio: String(r.Hora_Inicio || "") });
        return;
      }
      const mat = String(r.Matriz || "").trim();
      if (!esTM(mat)) return;
      const nombre = String(r.Nombre_Matriz || mat).trim();
      if (!davidOtrosMap.has(mat)) davidOtrosMap.set(mat, { nombre, seg: 0 });
      davidOtrosMap.get(mat)!.seg += seg;
    });
    davidCMs.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    const davidOtrosTM = [...davidOtrosMap.values()].sort((a, b) => b.seg - a.seg);

    const eduardoMatAggr = new Map<string, { segTrab: number; uni: number }>();
    const eduardoTMaggr = new Map<string, { nombre: string; seg: number }>();
    allRegs.forEach((r: any) => {
      const leg = String(r.Legajo || "").trim();
      if (!esEduardo(leg)) return;
      const seg = nm(r.Segundos_Trabajados);
      const mat = String(r.Matriz || "").trim();
      if (!esCM(r) && esMatriz(mat) && !esPiedra(mat) && nm(r.Uni) > 0) {
        if (!eduardoMatAggr.has(mat)) eduardoMatAggr.set(mat, { segTrab: 0, uni: 0 });
        const g = eduardoMatAggr.get(mat)!;
        g.segTrab += seg;
        g.uni += nm(r.Uni);
        return;
      }
      if (seg <= 0) return;
      if (esCM(r) || esTM(mat)) {
        const nombreTM = esCM(r) ? `Cambie matriz ${destinoCM(r)}` : String(r.Nombre_Matriz || mat).trim();
        const key = esCM(r) ? `CM_${destinoCM(r)}_${r.Hora_Inicio}` : mat;
        if (!eduardoTMaggr.has(key)) eduardoTMaggr.set(key, { nombre: nombreTM, seg: 0 });
        eduardoTMaggr.get(key)!.seg += seg;
      }
    });
    const eduardoMats: EduardoMat[] = [...eduardoMatAggr.entries()].map(([mat, g]) => {
      const info = matMap.get(mat);
      const nombre = info?.Matriz || "";
      const tHist = nm(info?.Tiempo_Historico);
      const segXUni = g.uni > 0 ? g.segTrab / g.uni : 0;
      const premio = tHist > 0 ? (-(segXUni / tHist - 1)) * 10 : null;
      return { matriz: mat, nombre, prom: segXUni, premio, segXUni };
    }).sort((a, b) => sortMatriz(a.matriz, b.matriz));
    const eduardoTMs: TMEntry[] = [...eduardoTMaggr.values()].sort((a, b) => b.seg - a.seg);

    // ===== AUSENTES: operarios activos que no aparecen hoy pero estuvieron en >1 de los ultimos 4 dias laborables =====
    const ausentes: AusenteEntry[] = [];
    try {
      const baseAR = fechaOverride ? new Date(fechaOverride + "T12:00:00") : argNow();
      const lab4 = ultimosNLaborables(baseAR, 4);
      // Quien aparece hoy (cualquier registro)
      const todayActiveSet = new Set<string>();
      allRegs.forEach((r: any) => {
        const leg = sinLetra(String(r.Legajo || "").trim());   // Empleados no tiene la letra: c19 de 3.0 = 19
        if (leg) todayActiveSet.add(leg);
      });
      // Buscar registros en los 4 dias laborables anteriores
      const fechaMin = `${lab4[lab4.length - 1].anio}-${String(lab4[lab4.length - 1].mes).padStart(2,"0")}-${String(lab4[lab4.length - 1].dia).padStart(2,"0")}`;
      const fechaMax = `${lab4[0].anio}-${String(lab4[0].mes).padStart(2,"0")}-${String(lab4[0].dia).padStart(2,"0")}`;
      const labKeys = new Set(lab4.map(d => `${d.anio}-${String(d.mes).padStart(2,"0")}-${String(d.dia).padStart(2,"0")}`));
      const prevRegs: any[] = []; let pfrom = 0;
      while (true) {
        const { data } = await espejo()
          .select("Legajo, Fecha, Dia, Mes")
          .gte("Fecha", fechaMin + "T00:00:00")
          .lte("Fecha", fechaMax + "T23:59:59")
          .or("Eliminar.is.null,Eliminar.neq.S")
          .range(pfrom, pfrom + PAGE - 1);
        if (!data || !data.length) break;
        prevRegs.push(...data);
        if (data.length < PAGE) break;
        pfrom += PAGE;
      }
      const diasPorLegajo = new Map<string, Set<string>>();
      prevRegs.forEach((r: any) => {
        const leg = sinLetra(String(r.Legajo || "").trim());
        if (!leg || leg === "1") return;
        const fechaStr = String(r.Fecha || "").slice(0, 10);
        if (!labKeys.has(fechaStr)) return; // solo dias laborables
        if (!diasPorLegajo.has(leg)) diasPorLegajo.set(leg, new Set());
        diasPorLegajo.get(leg)!.add(fechaStr);
      });
      // Buscar empleados activos que no estan hoy y tienen >1 dia activo en los 4 anteriores
      empleadosData.forEach((e: any) => {
        const leg = String(e.Legajo || "").trim();
        if (!leg || leg === "1") return;
        if (String(e.Activo || "").toUpperCase() !== "SI") return;
        if (todayActiveSet.has(leg)) return;
        const dias = diasPorLegajo.get(leg)?.size || 0;
        if (dias > 1) {
          ausentes.push({ nombre: e.Empleado || leg, legajo: leg, diasActivos: dias });
        }
      });
      ausentes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    } catch (err) {
      console.error("Error calculando ausentes:", err);
    }

    const anyRight = piedraEmps.length > 0 || davidCMs.length + davidOtrosTM.length > 0 || eduardoMats.length + eduardoTMs.length > 0 || ausentes.length > 0;
    const reservaLateral = anyRight ? 44 : 0;
    const maxEmpsPerPage = Math.max(1, Math.floor((297 - 16 - 77 - reservaLateral) / 20));
    const empGroups: string[][] = []; for (let i = 0; i < empleados.length; i += maxEmpsPerPage) { empGroups.push(empleados.slice(i, i + maxEmpsPerPage)); } if (empGroups.length === 0) empGroups.push([]);
    const tituloFecha = fechaOverride ? fechaOverride.split("-").reverse().join("/") : fmtDate(ahora);
    const titulo = `Rendimiento x Matriz - ${tituloFecha} ${fmtTime(ahora)}`;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    if (cajones.length === 0 && piedraRegs.length === 0 && !davidCMs.length && !davidOtrosTM.length && !eduardoMats.length && !eduardoTMs.length && !ausentes.length) { doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.text(titulo, 8, 15); doc.setFontSize(12); doc.setFont("helvetica", "normal"); doc.text("Sin registros de produccion para hoy.", 8, 28); }
    else {
      empGroups.forEach((group, idx) => {
        if (idx > 0) doc.addPage();
        drawPage(doc, titulo, idx + 1, empGroups.length, matrices, group, matMap, empMap, dataMap, hsTotalByEmp, puntajeByEmp, tmByTypeByEmp, tmTypes, tmNombres, piedraEmps, idx === 0, davidCMs, davidOtrosTM, eduardoMats, eduardoTMs, ausentes);
      });
    }
    const pdfBytes = doc.output("arraybuffer"); const fileName = `rendimiento_${hoy}_${Date.now()}.pdf`;
    const { error: uploadError } = await sb.storage.from("reportes").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error("Error subiendo PDF: " + uploadError.message);
    // URL firmada en vez de publica: el PDF es nominal (nombre, legajo, rendimiento).
    // WhatsApp baja el archivo con esta URL y lo adjunta al mensaje, asi que el
    // destinatario lo conserva aunque la firma venza.
    const { data: urlData, error: urlError } = await sb.storage.from("reportes").createSignedUrl(fileName, URL_FIRMADA_SEG);
    if (urlError || !urlData?.signedUrl) throw new Error("Error firmando URL del PDF: " + (urlError?.message || "sin signedUrl"));
    const pdfUrl = urlData.signedUrl;
    const fechaHs = `${tituloFecha} ${fmtTime(ahora)}`; const waUrl = `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`;
    const resultados: { numero: string; ok: boolean; error?: string; intentos?: number }[] = [];
    const MAX_RETRIES = 3; const RETRY_DELAY = 5000;
    for (const num2 of nums) {
      let lastResult: any = { numero: num2, ok: false, error: "" };
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(waUrl, { method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: num2, type: "template", template: { name: "reporte_diario_rend_x_matriz", language: { code: "es_AR" }, components: [{ type: "header", parameters: [{ type: "document", document: { link: pdfUrl, filename: `Rendimiento_Matrices_${hoy}.pdf` } }] }, { type: "body", parameters: [{ type: "text", text: fechaHs }] }] } }) });
          const rData = await res.json();
          lastResult = { numero: num2, ok: res.ok, error: res.ok ? undefined : rData?.error?.message, intentos: attempt };
          if (res.ok) break;
          if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY);
        } catch (err) {
          lastResult = { numero: num2, ok: false, error: String(err), intentos: attempt };
          if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY);
        }
      }
      resultados.push(lastResult);
    }
    return new Response(JSON.stringify({ test, enviados: resultados.filter(r => r.ok).length, total: nums.length, registros: cajones.length + piedraRegs.length, matrices: matrices.length, piedra: piedraEmps.length, empleados: empleados.length, paginas: empGroups.length, maxEmpsPerPage, pdfUrl, fechaHs, davidCMs: davidCMs.length, davidOtrosTM: davidOtrosTM.length, eduardoMats: eduardoMats.length, eduardoTMs: eduardoTMs.length, ausentes: ausentes.length, resultados }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) { return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }); }
});
