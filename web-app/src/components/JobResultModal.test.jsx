import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import JobResultModal from "./JobResultModal";

describe("JobResultModal", () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  const mockJob = {
    id: "job_123",
    studentEmail: "student@school.edu",
    modelUsed: "gemini-3.5-flash-lite",
    cost: 0.0025,
    status: "completed",
    result: { summary: "Great progress on task 1", score: 95 },
  };

  it("renders job information and handles CSV, JSON, Markdown, and Text downloads", () => {
    render(<JobResultModal show={true} onClose={vi.fn()} job={mockJob} />);

    expect(screen.getAllByText(/student@school.edu/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/gemini-3.5-flash-lite/i)).toBeInTheDocument();

    const csvBtn = screen.getByRole("button", { name: /CSV/i });
    fireEvent.click(csvBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);

    const jsonBtn = screen.getByRole("button", { name: /JSON/i });
    fireEvent.click(jsonBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2);

    const mdBtn = screen.getByRole("button", { name: /Markdown/i });
    fireEvent.click(mdBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(3);

    const textBtn = screen.getByRole("button", { name: /Text Report/i });
    fireEvent.click(textBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(4);
  });

  it("handles copy to clipboard with feedback", async () => {
    render(<JobResultModal show={true} onClose={vi.fn()} job={mockJob} />);

    const copyBtn = screen.getByRole("button", { name: /Copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(screen.getByText(/Copied!/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
  });

  it("handles copy failure gracefully without throwing", async () => {
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<JobResultModal show={true} onClose={vi.fn()} job={mockJob} />);

    const copyBtn = screen.getByRole("button", { name: /Copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to copy"), expect.any(Error));
  });

  it("renders error details for failed jobs", () => {
    const failedJob = {
      id: "job_fail",
      studentEmail: "failing_student@school.edu",
      status: "failed",
      errorDetails: "FFmpeg frame extraction timeout.",
    };

    render(<JobResultModal show={true} onClose={vi.fn()} job={failedJob} />);

    expect(screen.getByText(/Error Details:/i)).toBeInTheDocument();
    expect(screen.getByText(/FFmpeg frame extraction timeout/i)).toBeInTheDocument();
  });

  it("handles string result and triggers close button", () => {
    const onClose = vi.fn();
    const stringJob = {
      id: "job_str",
      status: "running",
      result: "Plain text evaluation string",
    };

    const { rerender } = render(<JobResultModal show={true} onClose={onClose} job={stringJob} />);

    expect(screen.getByText(/Plain text evaluation string/i)).toBeInTheDocument();

    const closeBtns = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeBtns[0]);
    expect(onClose).toHaveBeenCalled();

    // Renders null when job is null
    rerender(<JobResultModal show={true} onClose={onClose} job={null} />);
    expect(screen.queryByText(/Plain text evaluation string/i)).not.toBeInTheDocument();
  });
});
