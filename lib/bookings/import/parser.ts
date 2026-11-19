import { ImportError } from "./errors";
import "server-only";
import { Worker } from "node:worker_threads";
import type { ImportFile } from "./types";
import { limits } from "./types";
const parserState = globalThis as unknown as { bookingImportParsers?: number };

// Isolated parser: no filesystem writes, formula evaluation, hyperlinks or network access.
// Hard wall-clock and heap limits also cover malformed/hostile workbook XML.
const workerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { inflateRawSync } = require('node:zlib');
const { limits, extension } = workerData;
class SafeParseError extends Error {}
function fail(message) { throw new SafeParseError(message); }
function parserModule(name) {
  try {
    // This code runs directly in Node, outside webpack's module rewriting.
    return require(require.resolve(name, { paths: [workerData.moduleRoot] }));
  } catch {
    fail('Die Dateiverarbeitung ist auf dem Server nicht verfügbar. Bitte die Installation der Import-Bibliotheken prüfen lassen.');
  }
}
function cell(value) {
  if (value == null) return null;
  if (value instanceof Date) return { excelDate: value.toISOString() };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) fail('Formelzellen werden nicht unterstützt. Bitte als Werte exportieren.');
    if (value.error) fail('Die Datei enthält Excel-Fehlerzellen. Bitte zuerst korrigieren.');
    if (value.richText) return value.richText.map(x => x.text).join('');
    if ('text' in value) return String(value.text);
    fail('Die Datei enthält einen nicht unterstützten Zelltyp.');
  }
  if (!['string','number','boolean'].includes(typeof value)) fail('Ungültiger Zellwert.');
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) fail('Eine Excel-Zahl überschreitet die sichere Zahlengenauigkeit. IDs bitte als Text exportieren.');
  return value;
}
function zipLimits(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) fail('Ungültige XLSX-Datei.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (count > 300 || count === 65535) fail('Die Excel-Datei enthält zu viele ZIP-Einträge.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) fail('Ungültige XLSX-Datei.');
    const size = buffer.readUInt32LE(offset + 24);
    const compressed = buffer.readUInt32LE(offset + 20), method = buffer.readUInt16LE(offset + 10);
    expanded += size;
    if (size === 0xffffffff || expanded > 20 * 1024 * 1024 || (buffer.readUInt16LE(offset + 8) & 1)) fail('Die entpackte Excel-Datei ist zu groß oder verschlüsselt (maximal 20 MiB).');
    const local = buffer.readUInt32LE(offset + 42);
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) fail('Ungültiger ZIP-Eintrag.');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length || ![0,8].includes(method)) fail('Nicht unterstützter ZIP-Eintrag.');
    const content = method === 0 ? buffer.subarray(start, start + compressed) : inflateRawSync(buffer.subarray(start,start + compressed), { maxOutputLength: 20 * 1024 * 1024 });
    if (content.length !== size) fail('Die tatsächliche ZIP-Größe stimmt nicht mit der deklarierten Größe überein.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
function sheet(name, input) {
  const nonempty = input.filter(r => r.values.some(v => v != null && String(v).trim() !== ''));
  if (!nonempty.length) return { name, headers: [], rows: [] };
  if (input.length > limits.rows + 1) fail('Maximal 1.000 Datenzeilen je Tabellenblatt sind erlaubt.');
  const width = Math.max(...nonempty.map(r => r.values.length));
  if (width > limits.columns) fail('Maximal 80 Spalten sind erlaubt.');
  const headers = Array.from({length: width}, (_, i) => String(nonempty[0].values[i] ?? ''));
  if (headers.some(h => !h.trim() || h.length > 255) || new Set(headers).size !== headers.length) fail('Spaltenüberschriften müssen eindeutig, nicht leer und höchstens 255 Zeichen lang sein.');
  const rows = nonempty.slice(1).map(r => {
    const raw = Object.fromEntries(headers.map((h, i) => {
      let value = r.values[i] ?? null;
      // Excel dates represent local wall time; retain a locale-neutral string without a false UTC assertion.
      if (value && typeof value === 'object' && value.excelDate) value = value.excelDate.slice(0,19);
      return [h, value];
    }));
    if (Buffer.byteLength(JSON.stringify(raw)) > limits.rowBytes) fail('Eine Quellzeile überschreitet 24 KiB.');
    return { sourceRow: r.number, raw };
  });
  return { name, headers, rows };
}
(async () => {
  const buffer = Buffer.from(workerData.buffer);
  let sheets;
  if (extension === 'xlsx') {
    zipLimits(buffer);
    const ExcelJS = parserModule('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer, { ignoreNodes: ['drawing','picture','extLst'] });
    if (book.worksheets.length > limits.sheets) fail('Maximal 10 Tabellenblätter sind erlaubt.');
    sheets = book.worksheets.map(ws => {
      if (ws.rowCount > limits.rows + 1 || ws.columnCount > limits.columns) fail('Maximal 1.000 Datenzeilen und 80 Spalten je Tabellenblatt sind erlaubt.');
      const rows = [];
      ws.eachRow((row, number) => {
        const values = [];
        for (let i = 1; i <= ws.columnCount; i++) values.push(cell(row.getCell(i).value));
        rows.push({ number, values });
      });
      return { ...sheet(ws.name, rows), date1904: !!book.properties.date1904 };
    });
  } else {
    const { parse } = parserModule('csv-parse/sync');
    // UTF-8 (with/without BOM) and BOM-marked UTF-16LE. No silent mojibake.
    const utf16 = buffer[0] === 255 && buffer[1] === 254;
    const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) fail('CSV bitte als UTF-8 oder UTF-16LE mit BOM speichern.');
    let records;
    for (const delimiter of [';', ',', '\t']) {
      try {
        const candidate = parse(text, { bom: true, delimiter, skip_empty_lines: true, relax_column_count: true,
          max_record_size: limits.rowBytes, info: true, raw: true, on_record(record) {
            if (record.info.records > limits.rows + 1) fail('Maximal 1.000 Datenzeilen sind erlaubt.');
            return record;
          } });
        if (candidate[0]?.record.length > 1) { records = candidate; break; }
      } catch (error) { if (!String(error.message).includes('Invalid Closing Quote') && !String(error.code).includes('QUOTE')) throw error; }
    }
    if (!records) fail('CSV-Trennzeichen nicht erkannt. Unterstützt werden Semikolon, Komma und Tabulator.');
    sheets = [sheet('CSV', records.map(r => ({ number: r.info.lines - (r.raw.replace(/(?:\r\n|\r|\n)$/, '').match(/\r\n|\r|\n/g) || []).length, values: r.record })))];
  }
  if (!sheets.length || !sheets.some(s => s.rows.length)) fail('Die Datei enthält keine Datenzeilen.');
  if (sheets.reduce((n,s) => n + s.rows.length, 0) > limits.rows) fail('Maximal 1.000 Datenzeilen pro Datei sind erlaubt.');
  const result = { sheets };
  if (Buffer.byteLength(JSON.stringify(result)) > limits.totalJsonBytes) fail('Die Zellwerte überschreiten zusammen 6 MiB.');
  parentPort.postMessage({ result });
})().catch(error => parentPort.postMessage({ error: error instanceof SafeParseError ? error.message : 'Die Datei konnte nicht gelesen werden. Bitte prüfe Format, Überschriften, Formelzellen und die Importgrenzen (5 MiB, 1.000 Zeilen, 80 Spalten, 10 Blätter, 24 KiB je Zeile, 20 MiB entpackt).' }));
`;

export async function parseImportFile(file: File): Promise<ImportFile> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xlsx"].includes(extension)) throw new ImportError("Bitte eine .xlsx- oder .csv-Datei auswählen.");
  if (!file.size || file.size > limits.bytes) throw new ImportError("Die Datei muss zwischen 1 Byte und 5 MiB groß sein.");
  const mimeTypes = extension === "xlsx" ? ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] : ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "text/comma-separated-values"];
  if (file.type && ![...mimeTypes, "application/octet-stream"].includes(file.type.toLowerCase())) throw new ImportError("Der Dateityp passt nicht zu einer unterstützten Excel-/CSV-Datei.");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (extension === "xlsx" && (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50)) throw new ImportError("Die Datei ist keine gültige XLSX-Datei.");
  if ((parserState.bookingImportParsers ?? 0) >= 2) throw new ImportError("Es werden gerade andere Importdateien eingelesen. Bitte in einigen Sekunden erneut versuchen.");
  parserState.bookingImportParsers = (parserState.bookingImportParsers ?? 0) + 1;
  return new Promise<ImportFile>((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      // Static references retain standalone dependency tracing. Actual resolution happens in the worker.
      workerData: { buffer, extension, limits, moduleRoot: process.cwd(), parserDependencies: [require.resolve("exceljs"), require.resolve("csv-parse/sync")] },
    });
    // Do not forward third-party parser diagnostics that might contain cell contents.
    worker.stdout?.resume(); worker.stderr?.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new ImportError("Das Einlesen dauert zu lange (maximal 10 Sekunden). Bitte die Datei verkleinern.")); }, 10_000);
    worker.once("message", (message: { result?: ImportFile; error?: string }) => {
      clearTimeout(timer); void worker.terminate();
      if (message.result) resolve(message.result); else reject(new ImportError(message.error ?? "Die Datei konnte nicht gelesen werden."));
    });
    worker.once("error", () => { clearTimeout(timer); reject(new ImportError("Die Datei überschreitet die Verarbeitungsgrenzen oder ist beschädigt.")); });
    worker.once("exit", () => { clearTimeout(timer); reject(new ImportError("Die Dateiverarbeitung wurde beendet. Bitte eine kleinere Datei verwenden.")); });
  }).finally(() => { parserState.bookingImportParsers = Math.max(0, (parserState.bookingImportParsers ?? 1) - 1); });
}
