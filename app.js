"use strict";

const state = { rows: [], filename: "", columns: new Set() };
const $ = (selector) => document.querySelector(selector);
const fileInput = $("#fileInput");
const alertBox = $("#alert");
const currencyFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const colors = ["#2d7fc1", "#eb8e39", "#2e9a78", "#9374c8", "#d65b60", "#44a4ac", "#d3ab43", "#607c99"];

const aliases = {
  ot: ["ot", "orden", "orden de trabajo"],
  start: ["fechainicio", "fechainicioreal", "fechacreacion", "fechacreación"],
  end: ["fechafin", "fechafindelaorden", "fecharealdefindelaorden"],
  type: ["tipomantenimiento", "tipodemantenimiento"],
  failure: ["modofalla", "mododefalla", "fallamodo"],
  equipment: ["equipo", "activo"],
  equipmentType: ["tipoequipo", "tipodeequipo"],
  criticality: ["criticidad", "crit"],
  labor: ["horasmanoobra", "horashombre", "hh"],
  downtime: ["downtimeh", "downtime", "horasindisponibilidad"],
  cost: ["costototalclp", "costodirecto", "costototal", "costoreales", "costesreales"],
  repair: ["tiemporeparacionh", "duracionoth", "mttrh"],
  status: ["estado", "statususuario", "statussistema"]
};

function canonicalHeader(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().replace(/^'+/, "").trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers, key) {
  const wanted = aliases[key] || [];
  return headers.find((header) => wanted.includes(canonicalHeader(header))) || null;
}

function parseDelimited(text) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.slice(0, source.search(/[\r\n]/) < 0 ? source.length : source.search(/[\r\n]/));
  const separators = [",", ";", "\t"];
  const delimiter = separators.map((candidate) => {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < firstLine.length; i += 1) {
      if (firstLine[i] === '"') {
        if (quoted && firstLine[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && firstLine[i] === candidate) count += 1;
    }
    return { candidate, count };
  }).sort((a, b) => b.count - a.count)[0].candidate;

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];
    if (character === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(field); field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (quoted) throw new Error("El archivo CSV contiene comillas sin cerrar.");
  if (rows.length < 2) throw new Error("El archivo no contiene filas de datos.");
  const headers = rows[0].map((header) => String(header).trim().replace(/^'+/, "").trim());
  const records = rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  return { headers, records };
}

function parseDate(value) {
  const text = String(value ?? "").trim().replace(/^'+/, "").trim();
  if (!text) return null;
  const localDate = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localDate) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = localDate;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let text = String(value ?? "").trim().replace(/^'+/, "").replace(/[\s$CLP]/gi, "");
  if (!text) return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    text = text.replace(/[.,]/g, (separator, offset) => separator === decimal && offset === Math.max(comma, dot) ? "." : "");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = text.split(separator);
    const isDecimal = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
    text = isDecimal ? `${parts[0]}.${parts[1]}` : parts.join("");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeType(value) {
  const text = String(value ?? "").trim().replace(/^'+/, "").replace(/\s+/g, " ");
  if (!text) return "Sin clasificar";
  const key = canonicalHeader(text);
  if (key.includes("correct")) return "Correctivo";
  if (key.includes("prevent")) return "Preventivo";
  if (key.includes("predict")) return "Predictivo";
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

function mapRecords(parsed) {
  const { headers, records } = parsed;
  const found = Object.fromEntries(Object.keys(aliases).map((key) => [key, findColumn(headers, key)]));
  if (!found.type) throw new Error("No se encontró la columna «Tipo_mantenimiento». Verifica que el archivo corresponda al esquema CMMS.");
  if (!found.ot && !found.start && !found.equipment) throw new Error("No se reconoció el esquema CMMS: se espera al menos OT, Fecha_inicio o Equipo.");
  state.columns = new Set(Object.entries(found).filter(([, column]) => column).map(([key]) => key));
  const mapped = records.map((record) => {
    const get = (key) => found[key] ? record[found[key]] : "";
    const date = parseDate(get("start")) || parseDate(get("end"));
    const repair = parseNumber(get("repair"));
    return {
      ot: String(get("ot") ?? "").trim().replace(/^'+/, ""),
      date,
      type: normalizeType(get("type")),
      failure: String(get("failure") ?? "").trim().replace(/^'+/, "") || "Sin modo de falla informado",
      equipment: String(get("equipment") ?? "").trim().replace(/^'+/, "") || "Sin equipo informado",
      equipmentType: String(get("equipmentType") ?? "").trim().replace(/^'+/, "") || "Sin tipo de equipo informado",
      criticality: String(get("criticality") ?? "").trim().replace(/^'+/, ""),
      labor: parseNumber(get("labor")),
      downtime: parseNumber(get("downtime")),
      cost: parseNumber(get("cost")),
      repair,
      status: String(get("status") ?? "").trim()
    };
  });
  return mapped.filter((record) => Object.values(record).some((value) => value !== null && value !== ""));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits }).format(value) : "—";
}

function fmtCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  const formatted = currencyFormat.format(value);
  return value >= 1_000_000_000 ? `$${fmt(value / 1_000_000_000, 1)} mil MM` : value >= 1_000_000 ? `$${fmt(value / 1_000_000, 1)} MM` : `$${formatted}`;
}

function fmtDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date)
    : "sin fecha";
}

function showAlert(message, isError = false) {
  alertBox.textContent = message;
  alertBox.classList.toggle("is-error", isError);
  alertBox.hidden = !message;
}

function sortedTypes(records) {
  const standard = ["Correctivo", "Preventivo", "Predictivo"];
  return [...new Set(records.map((record) => record.type))]
    .sort((a, b) => {
      const ai = standard.indexOf(a), bi = standard.indexOf(b);
      return (ai < 0 ? standard.length : ai) - (bi < 0 ? standard.length : bi) || a.localeCompare(b, "es");
    });
}

function getFilteredRows() {
  const type = $("#maintenanceFilter").value;
  const from = $("#dateFrom").value ? new Date(`${$("#dateFrom").value}T00:00:00`) : null;
  const to = $("#dateTo").value ? new Date(`${$("#dateTo").value}T23:59:59.999`) : null;
  return state.rows.filter((row) => {
    if (type && row.type !== type) return false;
    if (from && (!row.date || row.date < from)) return false;
    if (to && (!row.date || row.date > to)) return false;
    return true;
  });
}

function sum(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function average(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function median(records, key) {
  const values = records.map((record) => record[key]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function percent(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }

function closedCorrectiveRows(records) {
  return records.filter((row) => {
    if (row.type !== "Correctivo" || !Number.isFinite(row.repair)) return false;
    if (!state.columns.has("status") || !row.status) return true;
    const status = canonicalHeader(row.status);
    return status.includes("cerrad") || status.includes("teco");
  });
}

function metricsFor(records) {
  const corrective = closedCorrectiveRows(records);
  return {
    orders: records.length,
    labor: sum(records, "labor"),
    downtime: sum(records, "downtime"),
    cost: sum(records, "cost"),
    mttr: average(corrective, "repair"),
    repairMedian: median(corrective, "repair")
  };
}

function svgText(x, y, text, options = {}) {
  const anchor = options.anchor || "middle";
  const fill = options.fill || "#8593a1";
  const size = options.size || 9;
  const weight = options.weight || 400;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-family="Arial, sans-serif" font-weight="${weight}">${escapeHtml(text)}</text>`;
}

function emptyChart(message = "No hay datos disponibles para esta visualización.") {
  return `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function impactData(records) {
  const types = sortedTypes(records);
  const all = metricsFor(records);
  return types.map((type) => {
    const group = records.filter((row) => row.type === type);
    const values = metricsFor(group);
    return {
      type, orders: values.orders,
      orderShare: percent(values.orders, all.orders),
      laborShare: all.labor ? percent(values.labor || 0, all.labor) : null,
      downtimeShare: all.downtime ? percent(values.downtime || 0, all.downtime) : null,
      costShare: all.cost ? percent(values.cost || 0, all.cost) : null
    };
  });
}

function renderImpactChart(records) {
  const data = impactData(records);
  if (!data.length) return emptyChart();
  const series = [
    { key: "orderShare", label: "% OT", color: colors[0] },
    { key: "laborShare", label: "% HH", color: colors[1] },
    { key: "downtimeShare", label: "% Downtime", color: colors[2] },
    { key: "costShare", label: "% Costo", color: colors[3] }
  ].filter((series) => data.some((entry) => entry[series.key] !== null));
  const width = 800, height = 210, left = 42, right = 20, top = 17, bottom = 42;
  const plotW = width - left - right, plotH = height - top - bottom;
  const maxValue = Math.max(100, ...data.flatMap((entry) => series.map((item) => entry[item.key] || 0)));
  const scaleMax = Math.ceil(maxValue / 20) * 20;
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
  for (let tick = 0; tick <= scaleMax; tick += scaleMax / 4) {
    const y = top + plotH - (tick / scaleMax) * plotH;
    svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf1f4"/>${svgText(left - 7, y + 3, `${fmt(tick, 0)}%`, { anchor: "end", size: 8 })}`;
  }
  const groupWidth = plotW / data.length;
  const barGap = 3;
  const barWidth = Math.min(27, (groupWidth * .67 - barGap * (series.length - 1)) / series.length);
  data.forEach((entry, index) => {
    const totalWidth = series.length * barWidth + (series.length - 1) * barGap;
    const startX = left + index * groupWidth + (groupWidth - totalWidth) / 2;
    series.forEach((item, seriesIndex) => {
      const value = entry[item.key] || 0;
      const barHeight = (value / scaleMax) * plotH;
      const x = startX + seriesIndex * (barWidth + barGap);
      const y = top + plotH - barHeight;
      svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${item.color}"><title>${escapeHtml(entry.type)} · ${item.label}: ${fmt(value)}%</title></rect>`;
    });
    svg += svgText(left + index * groupWidth + groupWidth / 2, height - 17, entry.type, { fill: "#667789", size: 9 });
  });
  const legendTotal = series.length * 100 + (series.length - 1) * 18;
  let legendX = Math.max(left, (width - legendTotal) / 2);
  series.forEach((item) => {
    svg += `<rect x="${legendX}" y="${height - 5}" width="8" height="8" rx="2" fill="${item.color}"/>`;
    svg += svgText(legendX + 13, height + 2, item.label, { anchor: "start", size: 8, fill: "#647587" });
    legendX += 100 + 18;
  });
  return `${svg}</svg>`;
}

function renderMonthlyChart(records) {
  const monthly = new Map();
  records.forEach((row) => {
    if (!row.date) return;
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
    monthly.set(key, (monthly.get(key) || 0) + 1);
  });
  const entries = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  if (!entries.length) return emptyChart("No hay fechas válidas para mostrar la evolución.");
  const width = 560, height = 210, left = 39, right = 16, top = 15, bottom = 45;
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const scale = Math.ceil(max / 4) * 4 || 1;
  const plotW = width - left - right, plotH = height - top - bottom;
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i <= 4; i += 1) {
    const value = (scale / 4) * i;
    const y = top + plotH - (value / scale) * plotH;
    svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf1f4"/>${svgText(left - 7, y + 3, fmt(value, 0), { anchor: "end", size: 8 })}`;
  }
  const slot = plotW / entries.length, barWidth = Math.min(27, slot * .54);
  entries.forEach(([month, value], index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = (value / scale) * plotH;
    const y = top + plotH - barHeight;
    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${colors[0]}"><title>${month}: ${fmt(value, 0)} OT</title></rect>`;
    const [year, monthNum] = month.split("-");
    svg += svgText(x + barWidth / 2, height - 22, `${monthNum}/${year.slice(2)}`, { size: 8, fill: "#667789" });
  });
  return `${svg}</svg>`;
}

function renderHorizontalBars(entries, unit) {
  if (!entries.length) return emptyChart();
  const width = 800, top = 11, rowHeight = 25, bottom = 10, labelWidth = 220, right = 60;
  const height = top + entries.length * rowHeight + bottom;
  const barArea = width - labelWidth - right;
  const max = Math.max(1, ...entries.map((entry) => entry.value));
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
  entries.forEach((entry, index) => {
    const y = top + index * rowHeight;
    const barWidth = (entry.value / max) * barArea;
    const label = entry.label.length > 34 ? `${entry.label.slice(0, 31)}…` : entry.label;
    svg += svgText(labelWidth - 10, y + 14, label, { anchor: "end", fill: "#607285", size: 8 });
    svg += `<rect x="${labelWidth}" y="${y + 3}" width="${Math.max(barWidth, 1)}" height="14" rx="4" fill="${colors[index % colors.length]}"><title>${escapeHtml(entry.label)} · ${fmt(entry.value)} ${unit}</title></rect>`;
    svg += svgText(labelWidth + Math.max(barWidth, 1) + 6, y + 14, fmt(entry.value), { anchor: "start", fill: "#667789", size: 8 });
  });
  return `${svg}</svg>`;
}

function renderFailureChart(records) {
  const grouped = new Map();
  records.forEach((row) => {
    if (!row.failure || row.failure === "Sin modo de falla informado") return;
    grouped.set(row.failure, (grouped.get(row.failure) || 0) + 1);
  });
  const allEntries = [...grouped.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
  const entries = allEntries.slice(0, 10);
  if (!entries.length) return emptyChart("El dataset no contiene modos de falla informados.");
  const totalCount = allEntries.reduce((acc, entry) => acc + entry.value, 0);
  const width = 800, height = 300, left = 44, right = 37, top = 20, bottom = 100;
  const plotW = width - left - right, plotH = height - top - bottom;
  const maxValue = Math.max(1, ...entries.map((entry) => entry.value));
  const scale = Math.ceil(maxValue / 4) * 4 || 1;
  const slot = plotW / entries.length, barWidth = Math.min(42, slot * .56);
  let cumulative = 0;
  let linePoints = [];
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (scale / 4) * tick;
    const y = top + plotH - (value / scale) * plotH;
    svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf1f4"/>${svgText(left - 7, y + 3, fmt(value, 0), { anchor: "end", size: 8 })}`;
    svg += svgText(width - right + 8, y + 3, `${tick * 25}%`, { anchor: "start", size: 8 });
  }
  entries.forEach((entry, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = (entry.value / scale) * plotH;
    const y = top + plotH - barHeight;
    cumulative += entry.value;
    const cumulativeShare = (cumulative / totalCount) * 100;
    const pointX = x + barWidth / 2;
    const pointY = top + plotH - (cumulativeShare / 100) * plotH;
    linePoints.push(`${pointX},${pointY}`);
    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" fill="${colors[0]}"><title>${escapeHtml(entry.label)}: ${fmt(entry.value, 0)} OT</title></rect>`;
    svg += svgText(pointX, Math.max(top + 9, y - 5), fmt(entry.value, 0), { size: 8, fill: "#587087" });
    const label = entry.label.length > 21 ? `${entry.label.slice(0, 19)}…` : entry.label;
    svg += `<text x="${pointX}" y="${top + plotH + 13}" transform="rotate(-38 ${pointX} ${top + plotH + 13})" text-anchor="end" fill="#667789" font-size="8" font-family="Arial, sans-serif">${escapeHtml(label)}<title>${escapeHtml(entry.label)}</title></text>`;
  });
  svg += `<polyline points="${linePoints.join(" ")}" fill="none" stroke="${colors[1]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  linePoints.forEach((point, index) => {
    const [x, y] = point.split(",");
    const cumulativeShare = entries.slice(0, index + 1).reduce((acc, entry) => acc + entry.value, 0) / totalCount * 100;
    svg += `<circle cx="${x}" cy="${y}" r="3.2" fill="${colors[1]}"><title>Acumulado: ${fmt(cumulativeShare)}%</title></circle>`;
  });
  svg += `<rect x="${left + 5}" y="${height - 16}" width="9" height="9" rx="2" fill="${colors[0]}"/>`;
  svg += svgText(left + 19, height - 8, "Órdenes", { anchor: "start", size: 8, fill: "#647587" });
  svg += `<line x1="${left + 100}" y1="${height - 11}" x2="${left + 116}" y2="${height - 11}" stroke="${colors[1]}" stroke-width="2"/>`;
  svg += svgText(left + 122, height - 8, "% acumulado", { anchor: "start", size: 8, fill: "#647587" });
  return `${svg}</svg>`;
}

function renderMttrChart(records) {
  const grouped = new Map();
  closedCorrectiveRows(records).forEach((row) => {
    const values = grouped.get(row.equipmentType) || [];
    values.push(row.repair);
    grouped.set(row.equipmentType, values);
  });
  const entries = [...grouped.entries()].map(([label, values]) => ({
    label, value: values.reduce((sumValue, value) => sumValue + value, 0) / values.length
  })).sort((a, b) => b.value - a.value).slice(0, 8);
  return entries.length ? renderHorizontalBars(entries, "h") : emptyChart("Sin tiempos de reparación correctiva disponibles.");
}

function tableMarkup(records) {
  const rows = impactData(records);
  if (!rows.length) return `<tr><td colspan="6">Sin datos para los filtros aplicados</td></tr>`;
  return rows.map((row) => `<tr>
    <td>${escapeHtml(row.type)}</td><td>${fmt(row.orders, 0)}</td><td>${fmt(row.orderShare)}%</td>
    <td>${row.laborShare === null ? "—" : `${fmt(row.laborShare)}%`}</td>
    <td>${row.downtimeShare === null ? "—" : `${fmt(row.downtimeShare)}%`}</td>
    <td>${row.costShare === null ? "—" : `${fmt(row.costShare)}%`}</td>
  </tr>`).join("");
}

function updateInsight(records, metrics) {
  const maintenance = impactData(records);
  const corrective = maintenance.find((row) => row.type === "Correctivo");
  const largestFailure = new Map();
  records.forEach((row) => {
    if (row.failure !== "Sin modo de falla informado") largestFailure.set(row.failure, (largestFailure.get(row.failure) || 0) + 1);
  });
  const topFailure = [...largestFailure.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!records.length) {
    $("#keyInsight").textContent = "No hay órdenes que coincidan con los filtros seleccionados.";
  } else if (corrective) {
    const burden = corrective.downtimeShare;
    const shareText = burden === null ? `${fmt(corrective.orderShare)}% de las órdenes son correctivas` :
      `las órdenes correctivas representan ${fmt(corrective.orderShare)}% de las OT y ${fmt(burden)}% del downtime`;
    const failureText = topFailure ? ` El modo de falla más frecuente es «${topFailure[0]}» (${fmt(topFailure[1], 0)} OT).` : "";
    $("#keyInsight").textContent = `${shareText}.${failureText} ${metrics.mttr === null ? "No hay tiempos de reparación suficientes para estimar MTTR." : `El MTTR correctivo registrado es ${fmt(metrics.mttr)} h.`}`;
  } else {
    $("#keyInsight").textContent = topFailure
      ? `El modo de falla más frecuente es «${topFailure[0]}» (${fmt(topFailure[1], 0)} OT). El dataset no contiene órdenes correctivas para calcular MTTR.`
      : "No se encontraron datos de modo de falla en el período seleccionado.";
  }
}

function activePeriod(records) {
  const dates = records.map((row) => row.date).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return "Período no disponible";
  return `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;
}

function buildPrintReport(records) {
  const metrics = metricsFor(records);
  const chartConfigs = [
    ["Distribución de impacto por estrategia", "#impactChart", true],
    ["Evolución mensual de órdenes", "#monthlyChart", false],
    ["MTTR por tipo de equipo", "#mttrChart", false],
    ["Modos de falla prioritarios", "#failureChart", true]
  ];
  const charts = chartConfigs.map(([title, selector, wide]) => {
    const content = $(selector).querySelector("svg")?.outerHTML || `<p class="print-footnote">Sin datos para esta visualización.</p>`;
    return `<article class="print-chart${wide ? " wide" : ""}"><h3>${escapeHtml(title)}</h3>${content}</article>`;
  }).join("");
  const summary = $("#keyInsight").textContent;
  const stamp = new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date());
  const kpis = [
    ["Órdenes de trabajo", fmt(metrics.orders, 0)],
    ["Horas-hombre", metrics.labor === null ? "No disponible" : `${fmt(metrics.labor)} h`],
    ["Downtime total", metrics.downtime === null ? "No disponible" : `${fmt(metrics.downtime)} h`],
    ["Costo directo", metrics.cost === null ? "No disponible" : `$${currencyFormat.format(metrics.cost)} CLP`],
    ["MTTR correctivo", metrics.mttr === null ? "No disponible" : `${fmt(metrics.mttr)} h`],
    ["Mediana de reparación", metrics.repairMedian === null ? "No disponible" : `${fmt(metrics.repairMedian)} h`]
  ];
  $("#printReport").innerHTML = `
    <header class="print-cover">
      <div><div class="print-brand">CMMS INTELLIGENCE</div><div class="print-cover-rule"></div>
        <div class="print-title"><h1>Informe Ejecutivo de<br>Gestión de Mantenimiento</h1>
          <p>Análisis de órdenes de trabajo · ${escapeHtml(state.filename)}</p>
          <p class="print-meta">Período analizado: ${escapeHtml(activePeriod(records))}</p>
        </div>
      </div>
      <p class="print-meta">Generado el ${escapeHtml(stamp)} · Análisis local en navegador</p>
    </header>
    <section><h2>1. Resumen ejecutivo</h2>
      <div class="print-kpis">${kpis.map(([label, value]) => `<div class="print-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
      <div class="print-callout"><strong>Hallazgo del período:</strong> ${escapeHtml(summary)}</div>
      <div class="print-section"><h3>Distribución por tipo de mantenimiento</h3>
        <table><thead><tr><th>Tipo</th><th>OT</th><th>% OT</th><th>% HH</th><th>% Downtime</th><th>% Costo</th></tr></thead><tbody>${tableMarkup(records)}</tbody></table>
      </div>
    </section>
    <section class="print-section"><h2>2. Indicadores y tendencias</h2><div class="print-chart-grid">${charts}</div></section>
    <section class="print-section"><h2>3. Alcance y metodología</h2>
      <p>Los indicadores se calculan a partir de los registros del dataset y los filtros activos al momento de exportar. Los campos no disponibles en el origen no se estiman: se indican como «No disponible» o se omiten de la visualización.</p>
      <p class="print-footnote">MTTR y mediana: se calculan con Tiempo_reparacion_h para órdenes correctivas cerradas. Los porcentajes se calculan sobre el total de cada indicador disponible. El análisis es descriptivo y no reemplaza la validación de los datos fuente.</p>
    </section>`;
}

function renderDashboard() {
  const rows = getFilteredRows();
  const metrics = metricsFor(rows);
  $("#dashboard").hidden = false;
  $("#emptyState").hidden = true;
  $("#kpiOrders").textContent = fmt(metrics.orders, 0);
  $("#kpiLabor").textContent = metrics.labor === null ? "N/D" : `${fmt(metrics.labor)} h`;
  $("#kpiDowntime").textContent = metrics.downtime === null ? "N/D" : `${fmt(metrics.downtime)} h`;
  $("#kpiCost").textContent = metrics.cost === null ? "N/D" : fmtCurrency(metrics.cost);
  $("#kpiMttr").textContent = metrics.mttr === null ? "N/D" : `${fmt(metrics.mttr)} h`;
  $("#kpiMedian").textContent = metrics.repairMedian === null ? "N/D" : `${fmt(metrics.repairMedian)} h`;
  $("#kpiOrdersHint").textContent = `${fmt(rows.length, 0)} registros en el período`;
  $("#periodBadge").innerHTML = `<span class="status-dot"></span> ${escapeHtml(activePeriod(rows))}`;
  $("#periodBadge").classList.toggle("is-active", state.rows.length > 0);
  $("#pageSubtitle").textContent = `${fmt(rows.length, 0)} órdenes consideradas · ${state.filename}`;
  $("#impactChart").innerHTML = renderImpactChart(rows);
  $("#monthlyChart").innerHTML = renderMonthlyChart(rows);
  $("#mttrChart").innerHTML = renderMttrChart(rows);
  $("#failureChart").innerHTML = renderFailureChart(rows);
  $("#impactTable").innerHTML = tableMarkup(rows);
  $("#recordFooter").textContent = `${fmt(rows.length, 0)} órdenes visibles · ${activePeriod(rows)}`;
  updateInsight(rows, metrics);
  buildPrintReport(rows);
}

function setFiltersEnabled(enabled) {
  $("#maintenanceFilter").disabled = !enabled;
  $("#dateFrom").disabled = !enabled;
  $("#dateTo").disabled = !enabled;
  $("#resetFilters").disabled = !enabled;
  $("#exportPdf").disabled = !enabled;
}

function setDateBounds() {
  const dates = state.rows.map((row) => row.date).filter(Boolean);
  if (!dates.length) return;
  const toInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sorted = dates.sort((a, b) => a - b);
  $("#dateFrom").min = toInput(sorted[0]);
  $("#dateFrom").max = toInput(sorted[sorted.length - 1]);
  $("#dateTo").min = toInput(sorted[0]);
  $("#dateTo").max = toInput(sorted[sorted.length - 1]);
  $("#dateFrom").value = toInput(sorted[0]);
  $("#dateTo").value = toInput(sorted[sorted.length - 1]);
}

function acceptDataset(filename, parsed) {
  const rows = mapRecords(parsed);
  if (!rows.length) throw new Error("El archivo no contiene registros reconocibles.");
  state.rows = rows;
  state.filename = filename;
  $("#datasetName").textContent = filename;
  $("#datasetName").title = filename;
  const select = $("#maintenanceFilter");
  select.innerHTML = `<option value="">Todos los tipos</option>${sortedTypes(rows).map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}`;
  setFiltersEnabled(true);
  setDateBounds();
  const missing = [];
  if (!state.columns.has("labor")) missing.push("horas-hombre");
  if (!state.columns.has("downtime")) missing.push("downtime");
  if (!state.columns.has("cost")) missing.push("costos");
  if (!state.columns.has("repair")) missing.push("tiempo de reparación");
  showAlert(missing.length
    ? `Dataset cargado (${fmt(rows.length, 0)} filas). Campos ausentes: ${missing.join(", ")}; sus indicadores se muestran como no disponibles.`
    : `Dataset cargado correctamente: ${fmt(rows.length, 0)} filas reconocidas.`);
  renderDashboard();
}

async function loadXlsxLibrary() {
  if (window.XLSX) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("No se pudo cargar el lector Excel. Comprueba tu conexión e intenta cargar el archivo CSV equivalente."));
    document.head.appendChild(script);
  });
}

async function readSpreadsheet(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "csv") return parseDelimited(await file.text());
  if (extension !== "xlsx" && extension !== "xls") throw new Error("Formato no admitido. Selecciona un CSV o un libro Excel.");
  await loadXlsxLibrary();
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("El libro Excel no contiene hojas.");
  const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: true });
  if (rows.length < 2) throw new Error("La primera hoja del libro no contiene filas de datos.");
  const headers = rows[0].map((value) => String(value ?? "").trim());
  return { headers, records: rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) };
}

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  if (!file) return;
  showAlert("");
  try {
    const parsed = await readSpreadsheet(file);
    acceptDataset(file.name, parsed);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "No se pudo procesar el archivo seleccionado.", true);
  } finally {
    fileInput.value = "";
  }
});

$("#maintenanceFilter").addEventListener("change", renderDashboard);
$("#dateFrom").addEventListener("change", () => {
  if ($("#dateTo").value && $("#dateFrom").value > $("#dateTo").value) $("#dateTo").value = $("#dateFrom").value;
  renderDashboard();
});
$("#dateTo").addEventListener("change", () => {
  if ($("#dateFrom").value && $("#dateTo").value < $("#dateFrom").value) $("#dateFrom").value = $("#dateTo").value;
  renderDashboard();
});
$("#resetFilters").addEventListener("click", () => {
  $("#maintenanceFilter").value = "";
  setDateBounds();
  renderDashboard();
});
$("#exportPdf").addEventListener("click", () => {
  if (!state.rows.length) return;
  renderDashboard();
  window.print();
});
