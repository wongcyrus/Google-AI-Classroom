import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AlertsWidget from './AlertsWidget';
import MessagesWidget from './MessagesWidget';
import PropertiesWidget from './PropertiesWidget';
import Sidebar from './Sidebar';

describe('Student View Widgets', () => {
  describe('AlertsWidget', () => {
    it('renders empty alert message and IP placeholder when empty', () => {
      render(<AlertsWidget recentIrregularities={[]} ipAddress="" />);
      expect(screen.getByText('My Recent Alerts')).toBeInTheDocument();
      expect(screen.getByText('You have no recent alerts.')).toBeInTheDocument();
      expect(screen.getByText(/IP Address: Fetching\.\.\./i)).toBeInTheDocument();
    });

    it('renders alert items and IP address when provided', () => {
      const mockAlerts = [
        {
          id: 'alert_1',
          title: 'Looking Away Alert',
          timestamp: { toDate: () => new Date('2026-08-29T10:00:00Z') },
        },
      ];
      render(<AlertsWidget recentIrregularities={mockAlerts} ipAddress="192.168.1.50" />);
      expect(screen.getByText('Looking Away Alert')).toBeInTheDocument();
      expect(screen.getByText(/IP Address: 192\.168\.1\.50/i)).toBeInTheDocument();
    });
  });

  describe('MessagesWidget', () => {
    it('renders empty message state when no messages', () => {
      render(<MessagesWidget recentMessages={[]} />);
      expect(screen.getByText('My Recent Messages')).toBeInTheDocument();
      expect(screen.getByText('You have no recent messages.')).toBeInTheDocument();
    });

    it('renders messages with timestamps', () => {
      const mockMessages = [
        {
          id: 'msg_1',
          message: 'Please keep your webcam centered',
          timestamp: { toDate: () => new Date('2026-08-29T10:05:00Z') },
        },
      ];
      render(<MessagesWidget recentMessages={mockMessages} />);
      expect(screen.getByText('Please keep your webcam centered')).toBeInTheDocument();
    });
  });

  describe('PropertiesWidget', () => {
    it('renders empty properties state', () => {
      render(<PropertiesWidget classProperties={{}} myProperties={{}} />);
      expect(screen.getByText('Class Properties')).toBeInTheDocument();
      expect(screen.getByText('No class-wide properties defined.')).toBeInTheDocument();
    });

    it('renders class and student properties list', () => {
      render(
        <PropertiesWidget
          classProperties={{ frameRate: 15, invigilationMode: 'client_ai_fallback' }}
          myProperties={{ micAllowed: true }}
        />
      );
      expect(screen.getByText('frameRate')).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('My Properties')).toBeInTheDocument();
      expect(screen.getByText('micAllowed')).toBeInTheDocument();
      expect(screen.getByText('true')).toBeInTheDocument();
    });

    it('formats examReadiness and complex nested objects without rendering [object Object]', () => {
      render(
        <PropertiesWidget
          classProperties={{ tags: ['midterm', 'section-A'] }}
          myProperties={{
            examReadiness: { isReady: true, calibratedAt: '2026-08-31T06:00:00Z' },
            customMetadata: { seat: 'B-12', lab: 'Room 401' },
          }}
        />
      );

      expect(screen.getByText('examReadiness')).toBeInTheDocument();
      expect(screen.getByText('✅ Verified (Ready)')).toBeInTheDocument();
      expect(screen.getByText('tags')).toBeInTheDocument();
      expect(screen.getByText('midterm, section-A')).toBeInTheDocument();
      expect(screen.getByText('customMetadata')).toBeInTheDocument();
      expect(screen.getByText(/seat: B-12/i)).toBeInTheDocument();
      expect(screen.queryByText(/\[object Object\]/i)).not.toBeInTheDocument();
    });
  });

  describe('Sidebar', () => {
    it('renders all nested widgets within sidebar container', () => {
      render(
        <Sidebar
          classProperties={{ frameRate: 10 }}
          myProperties={{ role: 'student' }}
          recentIrregularities={[{ id: '1', title: 'Test Alert', timestamp: { toDate: () => new Date() } }]}
          recentMessages={[{ id: '1', message: 'Test Message', timestamp: { toDate: () => new Date() } }]}
          ipAddress="10.0.0.1"
        />
      );
      expect(screen.getByText('Class Properties')).toBeInTheDocument();
      expect(screen.getByText('My Recent Alerts')).toBeInTheDocument();
      expect(screen.getByText('My Recent Messages')).toBeInTheDocument();
      expect(screen.getByText(/IP Address: 10\.0\.0\.1/i)).toBeInTheDocument();
    });

    it('renders cleanly with default empty props', () => {
      render(<Sidebar />);
      expect(screen.getByText('Class Properties')).toBeInTheDocument();
      expect(screen.getByText('You have no recent alerts.')).toBeInTheDocument();
    });
  });
});
