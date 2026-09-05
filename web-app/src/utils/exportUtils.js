/**
 * Standardized Cross-Browser File Export Utility
 * Supports RFC 4180 CSV serialization, JSON formatting, and plain-text file downloads.
 * Includes UTF-8 BOM (\uFEFF) for CSV to guarantee correct rendering in Microsoft Excel.
 */

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
 * @param {string} content - File content
 * @param {string} filename - Filename with extension
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = "text/plain;charset=utf-8;") {
  const blob = new Blob([content], { type: mimeType });
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
 * Exports data to a CSV file and prompts download.
 * 
 * @param {Array<string>} headers - Column names
 * @param {Array<Array<*>>} rows - Row data
 * @param {string} filename - Output filename (defaults to data_export.csv)
 */
export function exportToCsv(headers, rows, filename = "data_export.csv") {
  const csvContent = generateCsvContent(headers, rows);
  downloadFile(csvContent, filename, "text/csv;charset=utf-8;");
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
