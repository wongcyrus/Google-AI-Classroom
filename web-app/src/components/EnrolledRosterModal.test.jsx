import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import EnrolledRosterModal from './EnrolledRosterModal';

describe('EnrolledRosterModal Component', () => {
  const emailList = [
    'alice@stu.vtc.edu.hk',
    'bob@stu.vtc.edu.hk',
    'charlie@stu.vtc.edu.hk',
    'david@stu.vtc.edu.hk',
  ];

  const resolvedProfilesMap = {
    'alice@stu.vtc.edu.hk': {
      studentName: 'Alice Wong',
      nickname: 'Ally',
      programme: 'HD in Software Engineering',
      studentClass: 'IT114115/1A',
      uid: 'uid_alice',
    },
    'bob@stu.vtc.edu.hk': {
      studentName: 'Bob Chan',
      nickname: '',
      programme: 'HD in Software Engineering',
      studentClass: 'IT114115/1A',
      _fromDirectory: true,
      uid: 'uid_bob',
    },
    'charlie@stu.vtc.edu.hk': {
      studentName: 'Charlie Cheung',
      nickname: 'Chuck',
      programme: 'HD in AI & Data Science',
      studentClass: 'IT114115/1B',
      uid: 'uid_charlie',
    },
    'david@stu.vtc.edu.hk': {
      studentName: '',
      nickname: '',
      programme: '',
      studentClass: '',
      uid: '',
    },
  };

  const registeredPasskeysMap = {
    'alice@stu.vtc.edu.hk': { deviceModel: 'iPhone 15 Pro' },
    'uid_bob': { deviceModel: 'Pixel 8' },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders modal with correct summary stats, chips, and student rows when visible', () => {
    const onClose = vi.fn();
    render(
      <EnrolledRosterModal
        show={true}
        onClose={onClose}
        className="Software Engineering Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    expect(screen.getByTestId('enrolled-roster-modal')).toBeInTheDocument();
    expect(screen.getByText(/Software Engineering Lab/i)).toBeInTheDocument();
    expect(screen.getByText(/4 Total Students/i)).toBeInTheDocument();
    expect(screen.getByText(/3\/4 Profile Metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/2\/4 Passkeys Linked/i)).toBeInTheDocument();
    expect(screen.getByText(/1 Auto-filled Directory/i)).toBeInTheDocument();

    // Verify student display
    expect(screen.getByText(/Ally \(Alice Wong\)/i)).toBeInTheDocument();
    expect(screen.getByText('alice@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getAllByText('Bob Chan').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('✨ Directory')).toBeInTheDocument();
    expect(screen.getAllByText('IT114115/1B').length).toBeGreaterThanOrEqual(1);

    // Verify passkey badges
    expect(screen.getAllByText(/📱 Linked/i).length).toBe(3);
    expect(screen.getAllByText(/⏳ Not Registered/i).length).toBe(3);

    // Close button
    fireEvent.click(screen.getByTitle('Close modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('filters students by search text matching name, email, and cohort', () => {
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    const searchInput = screen.getByTestId('roster-search-input');

    // Search by nickname
    fireEvent.change(searchInput, { target: { value: 'Chuck' } });
    expect(screen.getByText(/Chuck \(Charlie Cheung\)/i)).toBeInTheDocument();
    expect(screen.queryByText('alice@stu.vtc.edu.hk')).not.toBeInTheDocument();

    // Search by email domain/subpart
    fireEvent.change(searchInput, { target: { value: 'david' } });
    expect(screen.getAllByText('david@stu.vtc.edu.hk').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Charlie Cheung/i)).not.toBeInTheDocument();

    // Clear search
    fireEvent.click(screen.getByTitle('Clear search text'));
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3);
  });

  it('filters students by passkey status dropdown', () => {
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    const passkeyFilter = screen.getByTestId('roster-filter-passkey');

    // Filter Linked Only
    fireEvent.change(passkeyFilter, { target: { value: 'linked' } });
    expect(screen.getByText('alice@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('bob@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('charlie@stu.vtc.edu.hk')).not.toBeInTheDocument();
    expect(screen.queryByText('david@stu.vtc.edu.hk')).not.toBeInTheDocument();

    // Filter Unlinked Only
    fireEvent.change(passkeyFilter, { target: { value: 'unlinked' } });
    expect(screen.queryByText('alice@stu.vtc.edu.hk')).not.toBeInTheDocument();
    expect(screen.getByText('charlie@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getAllByText('david@stu.vtc.edu.hk').length).toBeGreaterThanOrEqual(1);
  });

  it('filters students by profile metadata status and cohort dropdown', () => {
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    const profileFilter = screen.getByTestId('roster-filter-profile');
    const cohortFilter = screen.getByTestId('roster-filter-cohort');

    // Filter by Directory auto-filled
    fireEvent.change(profileFilter, { target: { value: 'directory' } });
    expect(screen.getByText('bob@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('alice@stu.vtc.edu.hk')).not.toBeInTheDocument();

    // Reset and filter by Cohort
    fireEvent.change(profileFilter, { target: { value: 'all' } });
    fireEvent.change(cohortFilter, { target: { value: 'IT114115/1B' } });
    expect(screen.getByText('charlie@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('alice@stu.vtc.edu.hk')).not.toBeInTheDocument();

    // Reset filters button
    const clearBtn = screen.getByTestId('btn-clear-roster-filters');
    fireEvent.click(clearBtn);
    expect(screen.getByText('alice@stu.vtc.edu.hk')).toBeInTheDocument();
  });

  it('supports sorting columns on table header click', () => {
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    // Sort by Email
    const emailHeader = screen.getByTitle('Click to sort by Email');
    fireEvent.click(emailHeader);

    // Sort by Student Name
    const nameHeader = screen.getByTitle('Click to sort by Full Legal Name');
    fireEvent.click(nameHeader); // asc
    fireEvent.click(nameHeader); // desc

    // Sort by Passkey
    const passkeyHeader = screen.getByTitle('Click to sort by Phone Passkey Registration Status');
    fireEvent.click(passkeyHeader);
  });

  it('triggers passkey reset callback when reset button is clicked', () => {
    const onResetPasskey = vi.fn();
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
        onResetPasskey={onResetPasskey}
      />
    );

    const resetBtn = screen.getByTestId('btn-modal-reset-passkey-alice_stu_vtc_edu_hk');
    fireEvent.click(resetBtn);
    expect(onResetPasskey).toHaveBeenCalledWith('alice@stu.vtc.edu.hk', 'Alice Wong');
  });

  it('triggers onGrantBypass callback when Temp Bypass button is clicked and displays active bypass badge', () => {
    const onGrantBypass = vi.fn();
    const studentBypassesMap = {
      'bob@stu.vtc.edu.hk': {
        active: true,
        expiresAtMillis: Date.now() + 7200000,
        grantedBy: 'teacher@vtc.edu.hk',
      },
    };

    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
        studentBypassesMap={studentBypassesMap}
        onGrantBypass={onGrantBypass}
        bypassSuccessMsg="Bypass granted for Bob Chan"
      />
    );

    // Verify active bypass badge for Bob
    expect(screen.getByText(/⚡ Bypass Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Bypass granted for Bob Chan/i)).toBeInTheDocument();

    const bypassBtn = screen.getByTestId('btn-modal-bypass-alice_stu_vtc_edu_hk');
    fireEvent.click(bypassBtn);
    expect(onGrantBypass).toHaveBeenCalledWith('alice@stu.vtc.edu.hk', 'Alice Wong');
  });

  it('handles copying emails and exporting Excel', async () => {
    render(
      <EnrolledRosterModal
        show={true}
        onClose={vi.fn()}
        className="Cloud Lab"
        classId="IT114115_SE"
        emailList={emailList}
        resolvedProfilesMap={resolvedProfilesMap}
        registeredPasskeysMap={registeredPasskeysMap}
      />
    );

    // Copy emails
    const copyBtn = screen.getByTestId('btn-roster-copy-emails');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(emailList.join('\n'));
    expect(screen.getByText(/Copied 4 email\(s\) to clipboard!/i)).toBeInTheDocument();

    // Export Excel
    const exportBtn = screen.getByTestId('btn-roster-export-excel');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    expect(window.URL.createObjectURL).toHaveBeenCalled();
  });

  it('returns null when show is false', () => {
    const { container } = render(
      <EnrolledRosterModal
        show={false}
        onClose={vi.fn()}
        emailList={emailList}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
