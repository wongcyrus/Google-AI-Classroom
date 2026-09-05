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
  });
});
