import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { escapeCsvField, generateCsvContent, exportToCsv, exportToJson, exportToText } from "./exportUtils";

describe("exportUtils Unit Tests", () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;
  let clickedLink;

  beforeEach(() => {
    clickedLink = null;
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();

    vi.spyOn(document.body, "appendChild").mockImplementation((el) => {
      if (el.tagName === "A") {
        clickedLink = el;
        el.click = vi.fn();
      }
      return el;
    });
    vi.spyOn(document.body, "removeChild").mockImplementation(() => {});
  });

  afterEach(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  describe("escapeCsvField", () => {
    it("returns empty quotes for null and undefined", () => {
      expect(escapeCsvField(null)).toBe('""');
      expect(escapeCsvField(undefined)).toBe('""');
    });

    it("wraps simple strings and numbers in quotes", () => {
      expect(escapeCsvField("hello world")).toBe('"hello world"');
      expect(escapeCsvField(123)).toBe('"123"');
    });

    it("escapes commas, newlines, and internal quotes", () => {
      expect(escapeCsvField("hello, world")).toBe('"hello, world"');
      expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCsvField('She said "Hello"')).toBe('"She said ""Hello"""');
    });

    it("serializes nested objects to JSON string before escaping", () => {
      expect(escapeCsvField({ a: 1 })).toBe('"{""a"":1}"');
    });
  });

  describe("generateCsvContent", () => {
    it("prepends UTF-8 BOM and joins rows with CRLF", () => {
      const headers = ["Name", "Score"];
      const rows = [["Alice", 95], ["Bob, Jr.", 88]];
      const csv = generateCsvContent(headers, rows);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain('"Name","Score"\r\n"Alice","95"\r\n"Bob, Jr.","88"');
    });
  });

  describe("exportToCsv", () => {
    it("creates download link and triggers click with correct filename", () => {
      exportToCsv(["H1", "H2"], [["v1", "v2"]], "test_report.csv");
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(clickedLink).not.toBeNull();
      expect(clickedLink.getAttribute("download")).toBe("test_report.csv");
      expect(clickedLink.click).toHaveBeenCalled();
    });
  });

  describe("exportToJson", () => {
    it("creates JSON blob and triggers download", () => {
      exportToJson({ key: "value" }, "data.json");
      expect(clickedLink.getAttribute("download")).toBe("data.json");
      expect(clickedLink.click).toHaveBeenCalled();
    });
  });

  describe("exportToText", () => {
    it("creates text blob and triggers download", () => {
      exportToText("sample log", "log.txt");
      expect(clickedLink.getAttribute("download")).toBe("log.txt");
      expect(clickedLink.click).toHaveBeenCalled();
    });
  });
});