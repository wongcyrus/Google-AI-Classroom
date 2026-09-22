import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchStudentUploadModal from './BatchStudentUploadModal';

describe('BatchStudentUploadModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <BatchStudentUploadModal isOpen={false} onClose={() => {}} onApply={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with download template button and textarea when open', () => {
    render(
      <BatchStudentUploadModal isOpen={true} onClose={() => {}} onApply={() => {}} />
    );
    expect(screen.getByText(/Batch Upload Student Roster/i)).toBeDefined();
    expect(screen.getByText(/Download (Excel|CSV) Template/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/StudentEmail,StudentName/i)).toBeDefined();
  });

  it('parses pasted CSV, displays summary count, and previews student rows', () => {
    const onApply = vi.fn();
    render(
      <BatchStudentUploadModal isOpen={true} onClose={() => {}} onApply={onApply} />
    );

    const textarea = screen.getByPlaceholderText(/StudentEmail,StudentName/i);
    const sampleCsv = `StudentEmail,StudentName,Nickname,Programme,Class
230123456@stu.vtc.edu.hk,Chan Tai Man,David,HDSE,IT114115/1A
bob@school.edu,,,,`;

    fireEvent.change(textarea, { target: { value: sampleCsv } });

    // Summary alert
    expect(screen.getByText(/Parsed 2 students:/i)).toBeDefined();
    expect(screen.getByText(/David \(Chan Tai Man\)/i)).toBeDefined();
    expect(screen.getAllByText(/IT114115\/1A/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/230123456@stu.vtc.edu.hk/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/bob@school.edu/i).length).toBeGreaterThanOrEqual(1);

    // Click Apply
    const applyButton = screen.getByRole('button', { name: /Apply to Class Roster/i });
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    const appliedPayload = onApply.mock.calls[0][0];
    expect(appliedPayload.studentEmails).toContain('230123456@stu.vtc.edu.hk');
    expect(appliedPayload.studentEmails).toContain('bob@school.edu');
    expect(appliedPayload.studentProfiles['230123456@stu.vtc.edu.hk'].studentName).toBe('Chan Tai Man');
    expect(appliedPayload.studentProfiles['230123456@stu.vtc.edu.hk'].nickname).toBe('David');
    expect(appliedPayload.studentProfiles['230123456@stu.vtc.edu.hk'].studentClass).toBe('IT114115/1A');
  });

  it('merges with existing emails and profiles when merge mode is selected', () => {
    const onApply = vi.fn();
    const existingEmails = ['existing@school.edu'];
    const existingProfiles = {
      'existing@school.edu': {
        studentName: 'Existing Student',
        nickname: 'Ex',
        studentClass: 'IT101',
      },
    };

    render(
      <BatchStudentUploadModal
        isOpen={true}
        onClose={() => {}}
        onApply={onApply}
        existingEmails={existingEmails}
        existingProfiles={existingProfiles}
      />
    );

    const textarea = screen.getByPlaceholderText(/StudentEmail,StudentName/i);
    fireEvent.change(textarea, {
      target: {
        value: `StudentEmail,StudentName,Nickname,Class\nnew@school.edu,New Guy,Nick,IT102`,
      },
    });

    const applyButton = screen.getByRole('button', { name: /Apply to Class Roster/i });
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0];
    expect(payload.studentEmails).toContain('existing@school.edu');
    expect(payload.studentEmails).toContain('new@school.edu');
    expect(payload.studentProfiles['existing@school.edu'].studentName).toBe('Existing Student');
    expect(payload.studentProfiles['new@school.edu'].studentName).toBe('New Guy');
  });

  it('replaces entire roster when replace mode is selected', () => {
    const onApply = vi.fn();
    const existingEmails = ['existing@school.edu'];

    render(
      <BatchStudentUploadModal
        isOpen={true}
        onClose={() => {}}
        onApply={onApply}
        existingEmails={existingEmails}
      />
    );

    const replaceRadio = screen.getByLabelText(/Replace entire roster/i);
    fireEvent.click(replaceRadio);

    const textarea = screen.getByPlaceholderText(/StudentEmail,StudentName/i);
    fireEvent.change(textarea, {
      target: {
        value: `StudentEmail,StudentName\nonly_new@school.edu,Only New`,
      },
    });

    const applyButton = screen.getByRole('button', { name: /Apply to Class Roster/i });
    fireEvent.click(applyButton);

    const payload = onApply.mock.calls[0][0];
    expect(payload.studentEmails).toEqual(['only_new@school.edu']);
    expect(payload.studentEmails).not.toContain('existing@school.edu');
  });

  it('correctly parses and applies roster containing Chinese nicknames and names', () => {
    const onApply = vi.fn();
    render(
      <BatchStudentUploadModal isOpen={true} onClose={() => {}} onApply={onApply} />
    );

    const textarea = screen.getByPlaceholderText(/StudentEmail,StudentName/i);
    const chineseCsv = `StudentEmail,StudentName,Nickname,Programme,Class
230123456@stu.vtc.edu.hk,Chan Tai Man,大文,軟體工程,IT114115/1A
230987654@stu.vtc.edu.hk,Wong Ka Yan,阿欣,軟體工程,IT114115/1B`;

    fireEvent.change(textarea, { target: { value: chineseCsv } });

    // Live preview table verifies display names
    expect(screen.getByText(/大文 \(Chan Tai Man\)/i)).toBeDefined();
    expect(screen.getByText(/阿欣 \(Wong Ka Yan\)/i)).toBeDefined();

    const applyButton = screen.getByRole('button', { name: /Apply to Class Roster/i });
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0];
    expect(payload.studentProfiles['230123456@stu.vtc.edu.hk'].nickname).toBe('大文');
    expect(payload.studentProfiles['230123456@stu.vtc.edu.hk'].studentName).toBe('Chan Tai Man');
    expect(payload.studentProfiles['230987654@stu.vtc.edu.hk'].nickname).toBe('阿欣');
  });

  it('handles file upload containing Chinese characters', async () => {
    const onApply = vi.fn();
    const { container } = render(
      <BatchStudentUploadModal isOpen={true} onClose={() => {}} onApply={onApply} />
    );

    const fileContent = 'StudentEmail,StudentName,Nickname,Class\n230123456@stu.vtc.edu.hk,Chan Tai Man,大文,IT114115/1A';
    const file = new File([fileContent], 'roster.csv', { type: 'text/csv' });

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeDefined();

    fireEvent.change(fileInput, { target: { files: [file] } });

    // Wait for async file decoding
    const previewName = await screen.findByText(/大文 \(Chan Tai Man\)/i);
    expect(previewName).toBeDefined();
  });
});
