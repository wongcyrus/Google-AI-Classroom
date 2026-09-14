import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PropertiesWidget, { formatPropertyValue } from './PropertiesWidget';

describe('PropertiesWidget Component and Helpers', () => {
  describe('formatPropertyValue helper', () => {
    it('formats null and undefined as —', () => {
      expect(formatPropertyValue('test', null)).toBe('—');
      expect(formatPropertyValue('test', undefined)).toBe('—');
    });

    it('formats booleans', () => {
      expect(formatPropertyValue('test', true)).toBe('true');
      expect(formatPropertyValue('test', false)).toBe('false');
    });

    it('formats examReadiness object', () => {
      expect(formatPropertyValue('examReadiness', { isReady: true })).toBe('✅ Verified (Ready)');
      expect(formatPropertyValue('examReadiness', { isReady: false })).toBe('⚠️ Incomplete');
    });

    it('formats timestamps and dates', () => {
      const date = new Date('2026-09-01T10:00:00Z');
      expect(formatPropertyValue('time', { toDate: () => date })).toBe(date.toLocaleString());
      expect(formatPropertyValue('time', { seconds: 1788220800 })).toBe(new Date(1788220800 * 1000).toLocaleString());
    });

    it('formats arrays and objects', () => {
      expect(formatPropertyValue('items', ['apple', 'banana'])).toBe('apple, banana');
      expect(formatPropertyValue('details', { group: 'A', room: '101' })).toContain('group: A');
      expect(formatPropertyValue('empty', {})).toBe('{}');
    });
  });

  describe('PropertiesWidget rendering', () => {
    it('renders empty states when no properties exist', () => {
      render(<PropertiesWidget classProperties={{}} myProperties={{}} />);

      expect(screen.getByText(/Class Properties/i)).toBeInTheDocument();
      expect(screen.getByText(/No class-wide properties defined/i)).toBeInTheDocument();
      expect(screen.queryByText(/My Properties/i)).not.toBeInTheDocument();
    });

    it('renders class and my properties', () => {
      const classProps = {
        Room: 'Lab 402',
        Instructor: 'Dr. Wong',
      };
      const myProps = {
        Seat: 'Row 3, Desk 4',
        Group: 'Alpha',
      };

      render(<PropertiesWidget classProperties={classProps} myProperties={myProps} />);

      expect(screen.getByText('Room')).toBeInTheDocument();
      expect(screen.getByText('Lab 402')).toBeInTheDocument();
      expect(screen.getByText(/My Properties/i)).toBeInTheDocument();
      expect(screen.getByText('Seat')).toBeInTheDocument();
      expect(screen.getByText('Row 3, Desk 4')).toBeInTheDocument();
    });

    it('filters out internal bingo and operational state machine keys from My Properties', () => {
      const myPropsWithInternal = {
        Seat: 'B-12',
        team: 'Red Dragons',
        pendingRetryBingo: false,
        'activeBingo.status': 'passed',
        activeBingo: {
          question: 'What is shown on slide 3?',
          status: 'closed',
          options: ['A', 'B', 'C'],
        },
        strikeNumber: 0,
        bingoStats: { passed: 1, failed: 0 },
        lastBingoIssuedAt: { seconds: 1789349510 },
        priorMissedBingoId: 'xyz123',
        retryBingoScheduledAtMillis: 1789349555,
        retryDelayMinutes: 3,
        lastRetryDispatchedAt: { seconds: 1789349560 },
        examReadiness: { isReady: true },
      };

      render(<PropertiesWidget classProperties={{}} myProperties={myPropsWithInternal} />);

      // Real properties should be visible
      expect(screen.getByText('Seat')).toBeInTheDocument();
      expect(screen.getByText('B-12')).toBeInTheDocument();
      expect(screen.getByText('team')).toBeInTheDocument();
      expect(screen.getByText('Red Dragons')).toBeInTheDocument();

      // Internal bingo keys and examReadiness must NOT be in the document
      expect(screen.queryByText('examReadiness')).not.toBeInTheDocument();
      expect(screen.queryByText('✅ Verified (Ready)')).not.toBeInTheDocument();
      expect(screen.queryByText('pendingRetryBingo')).not.toBeInTheDocument();
      expect(screen.queryByText('activeBingo.status')).not.toBeInTheDocument();
      expect(screen.queryByText('activeBingo')).not.toBeInTheDocument();
      expect(screen.queryByText('strikeNumber')).not.toBeInTheDocument();
      expect(screen.queryByText('bingoStats')).not.toBeInTheDocument();
      expect(screen.queryByText('lastBingoIssuedAt')).not.toBeInTheDocument();
      expect(screen.queryByText('priorMissedBingoId')).not.toBeInTheDocument();
      expect(screen.queryByText('retryBingoScheduledAtMillis')).not.toBeInTheDocument();
      expect(screen.queryByText('retryDelayMinutes')).not.toBeInTheDocument();
      expect(screen.queryByText('lastRetryDispatchedAt')).not.toBeInTheDocument();
    });

    it('does not render My Properties if only internal operational fields exist', () => {
      const internalOnly = {
        pendingRetryBingo: false,
        strikeNumber: 0,
        activeBingo: { status: 'passed' },
      };

      render(<PropertiesWidget classProperties={{}} myProperties={internalOnly} />);
      expect(screen.queryByText(/My Properties/i)).not.toBeInTheDocument();
    });
  });
});

