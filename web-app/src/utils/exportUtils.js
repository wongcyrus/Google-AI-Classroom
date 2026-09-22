/**
 * Standardized Cross-Browser File Export Utility
 * Supports Native Microsoft Excel (.xlsx) OpenXML generation,
 * RFC 4180 CSV serialization, JSON formatting, and plain-text file downloads.
 */

import writeXlsxFile from 'write-excel-file/universal';
import readXlsxFile from 'read-excel-file/universal';

/**
 * Escapes a single field value for RFC 4180 CSV compliance.
 * - Wraps fields in quotes if they contain commas, newlines, or quotes.
 * - Doubles internal double quotes.
 * 
 * @param {*} val - Value to escape
 * @returns {string} Escaped string
 */
export function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates an RFC 4180 compliant CSV string with UTF-8 BOM.
 * 
 * @param {Array<string>} headers - Header column names
 * @param {Array<Array<*>>} rows - 2D array of rows
 * @returns {string} Complete CSV string with BOM
 */
export function generateCsvContent(headers, rows) {
  const headerLine = headers.map(h => escapeCsvField(h)).join(",");
  const rowLines = rows.map(row => row.map(cell => escapeCsvField(cell)).join(","));
  return "\uFEFF" + [headerLine, ...rowLines].join("\r\n");
}

/**
 * Triggers a browser download of text/blob data.
 * 
 * @param {string|Blob} content - File content or Blob
 * @param {string} filename - Filename with extension
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = "text/plain;charset=utf-8;") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a Blob directly with safe link removal.
 * 
 * @param {Blob} blob 
 * @param {string} filename 
 */
export function downloadBlob(blob, filename) {
  downloadFile(blob, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/**
 * Standardized Cross-Browser Microsoft Excel (.xlsx) Export Utility.
 * Generates genuine OpenXML workbooks with bold headers, preserving UTF-8 Unicode
 * for Chinese characters, numbers, and booleans without code page errors.
 * 
 * @param {Array<string>} headers - Column names
 * @param {Array<Array<*>>} rows - Row data
 * @param {string} filename - Output filename (defaults to data_export.xlsx)
 * @returns {Promise<Blob>} Generated Excel Blob
 */
export async function exportToExcel(headers = [], rows = [], filename = "data_export.xlsx") {
  const cleanFilename = filename.toLowerCase().endsWith('.xlsx')
    ? filename
    : `${filename.replace(/\.csv$/i, '')}.xlsx`;

  // Format headers with bold styling
  const headerCells = headers.map(h => ({
    value: String(h ?? ''),
    fontWeight: 'bold',
  }));

  // Format data cells with native type mapping
  const dataCells = rows.map(row =>
    (row || []).map(cell => {
      if (cell === null || cell === undefined) {
        return { type: String, value: '' };
      }
      if (typeof cell === 'number') {
        return { type: Number, value: cell };
      }
      if (typeof cell === 'boolean') {
        return { type: Boolean, value: cell };
      }
      return { type: String, value: String(cell) };
    })
  );

  const fileData = [headerCells, ...dataCells];
  const result = await writeXlsxFile(fileData, { buffer: true });
  const blob = typeof result?.toBlob === 'function' ? await result.toBlob() : result;

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    downloadBlob(blob, cleanFilename);
  }

  return blob;
}

/**
 * Reads an Excel (.xlsx / .xls) file or ArrayBuffer into a 2D array of rows.
 * 
 * @param {File|Blob|ArrayBuffer} fileOrBuffer 
 * @returns {Promise<Array<Array<*>>>} 2D array of cell values
 */
export async function readExcelFile(fileOrBuffer) {
  if (!fileOrBuffer) return [];
  let buffer = fileOrBuffer;
  if (typeof fileOrBuffer.arrayBuffer === 'function') {
    buffer = await fileOrBuffer.arrayBuffer();
  }
  const result = await readXlsxFile(buffer);
  if (!result || result.length === 0) return [];

  // If result is an array of sheet objects [{ sheet: 'Sheet1', data: [...] }]
  if (result[0] && Array.isArray(result[0].data)) {
    return result[0].data;
  }
  return result;
}

/**
 * Exports data to an Excel (.xlsx) file, maintaining backward compatibility for legacy callers.
 * 
 * @param {Array<string>} headers - Column names
 * @param {Array<Array<*>>} rows - Row data
 * @param {string} filename - Output filename (converted to .xlsx)
 */
export function exportToCsv(headers, rows, filename = "data_export.xlsx") {
  const excelFilename = filename.replace(/\.csv$/i, '.xlsx');
  return exportToExcel(headers, rows, excelFilename);
}

/**
 * Exports an object or array as formatted JSON.
 * 
 * @param {object|Array} data - JavaScript object to export
 * @param {string} filename - Output filename (defaults to export.json)
 */
export function exportToJson(data, filename = "export.json") {
  const jsonContent = JSON.stringify(data, null, 2);
  downloadFile(jsonContent, filename, "application/json;charset=utf-8;");
}

/**
 * Exports plain text to a text file.
 * 
 * @param {string} text - Text content
 * @param {string} filename - Output filename
 */
export function exportToText(text, filename = "export.txt") {
  downloadFile(text, filename, "text/plain;charset=utf-8;");
}
