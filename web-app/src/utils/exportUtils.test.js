import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { escapeCsvField, generateCsvContent, exportToExcel, readExcelFile, exportToJson, exportToText, exportTaskGradingToExcel } from "./exportUtils";

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

  describe("exportToExcel", () => {
    it("creates Excel (.xlsx) download link and triggers click with correct filename", async () => {
      const blob = await exportToExcel(["Name", "Score"], [["Alice", 95]], "test_report.xlsx");
      expect(blob).toBeInstanceOf(Blob);
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(clickedLink).not.toBeNull();
      expect(clickedLink.getAttribute("download")).toBe("test_report.xlsx");
      expect(clickedLink.click).toHaveBeenCalled();
    });

    it("reads rows accurately from an exported Excel file", async () => {
      const blob = await exportToExcel(["Email", "Name"], [["test@stu.vtc.edu.hk", "陳大文"]], "students.xlsx");
      const rows = await readExcelFile(blob);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(["Email", "Name"]);
      expect(rows[1]).toEqual(["test@stu.vtc.edu.hk", "陳大文"]);
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

  describe("exportTaskGradingToExcel", () => {
    it("exports task grading matrix with student profile and step results", async () => {
      const task = {
        title: "Docker Lab",
        maxScore: 100,
        rubricSteps: [
          { stepNumber: 1, title: "Git Clone" },
          { stepNumber: 2, title: "Docker Build" },
        ],
      };
      const submissions = [
        {
          displayName: "大文 (Chan Tai Man)",
          email: "taiman@vtc.edu.hk",
          cohort: "IT114115/1A",
          programme: "Software Engineering",
          status: "evaluated",
          attemptsCount: 1,
          durationSeconds: 1500,
          effectiveScore: 90,
          driveWebViewLink: "https://drive.google.com/file/d/test-task-drive/view",
          evaluation: {
            finalScore: 90,
            stepResults: [
              { stepNumber: 1, status: "completed", scoreAwarded: 40 },
              { stepNumber: 2, status: "completed", scoreAwarded: 50 },
            ],
          },
        },
      ];

      const blob = await exportTaskGradingToExcel(task, submissions);
      expect(blob).toBeInstanceOf(Blob);
      expect(clickedLink.getAttribute("download")).toBe("Task_Docker_Lab_Grading_Results.xlsx");
      expect(clickedLink.click).toHaveBeenCalled();

      const rows = await readExcelFile(blob);
      expect(rows[0]).toContain("Student Display Name");
      expect(rows[0]).toContain("Google Drive Link");
      expect(rows[0]).toContain("Step 1: Git Clone");
      expect(rows[0]).toContain("Step 2: Docker Build");
      expect(rows[1]).toContain("大文 (Chan Tai Man)");
      expect(rows[1]).toContain("https://drive.google.com/file/d/test-task-drive/view");
      expect(rows[1]).toContain("40 pts (completed)");
    });

    it("resolves student identity when fields use studentEmail, studentClass, or profile aliases", async () => {
      const task = { title: "Python Lab", maxScore: 100, rubricSteps: [] };
      const submissions = [
        {
          studentEmail: "sub.fallback@vtc.edu.hk",
          studentName: "Fallback Student",
          studentClass: "AI-101",
          programme: "Cloud Computing",
          status: "submitted",
        },
      ];

      const blob = await exportTaskGradingToExcel(task, submissions);
      const rows = await readExcelFile(blob);
      expect(rows[1][0]).toBe("Fallback Student");
      expect(rows[1][1]).toBe("sub.fallback@vtc.edu.hk");
      expect(rows[1][2]).toBe("AI-101");
      expect(rows[1][3]).toBe("Cloud Computing");
    });
  });
});