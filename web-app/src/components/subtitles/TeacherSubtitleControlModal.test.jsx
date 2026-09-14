import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TeacherSubtitleControlModal from './TeacherSubtitleControlModal';

describe('TeacherSubtitleControlModal Component', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <TeacherSubtitleControlModal isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with engine selection, languages, and controls when isOpen is true', () => {
    const onToggleEnabled = vi.fn();
    const onSelectEngineMode = vi.fn();
    const onSelectSpeechLanguage = vi.fn();
    const onToggleTargetLanguage = vi.fn();
    const onClose = vi.fn();

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={onClose}
        enabled={false}
        onToggleEnabled={onToggleEnabled}
        engineMode="server"
        onSelectEngineMode={onSelectEngineMode}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={onSelectSpeechLanguage}
        targetLanguages={['zh-Hant', 'en']}
        onToggleTargetLanguage={onToggleTargetLanguage}
        isNanoAvailable={true}
        latestTranscript="測試說話"
        latestTranslations={{ 'zh-Hant': '測試說話翻譯' }}
        status="idle"
      />
    );

    expect(screen.getByText(/即時課堂字幕與多語言翻譯設定/i)).toBeInTheDocument();
    expect(screen.getByText(/開始廣播字幕/i)).toBeInTheDocument();

    // Toggle broadcast
    const broadcastBtn = screen.getByText(/開始廣播字幕/i);
    fireEvent.click(broadcastBtn);
    expect(onToggleEnabled).toHaveBeenCalled();

    // Select Client Model
    const clientRadio = screen.getByLabelText(/Client Model/i);
    fireEvent.click(clientRadio);
    expect(onSelectEngineMode).toHaveBeenCalledWith('client');

    // Select Gemini Live Model
    const liveRadio = screen.getByLabelText(/Gemini Live/i);
    fireEvent.click(liveRadio);
    expect(onSelectEngineMode).toHaveBeenCalledWith('firebase_live');

    // Change speech language
    const speechSelect = screen.getByLabelText(/老師發音語言/i);
    fireEvent.change(speechSelect, { target: { value: 'en-US' } });
    expect(onSelectSpeechLanguage).toHaveBeenCalledWith('en-US');

    // Toggle target language
    const jaCheckbox = screen.getByLabelText(/日本語/i);
    fireEvent.click(jaCheckbox);
    expect(onToggleTargetLanguage).toHaveBeenCalledWith('ja');

    // Close button
    const closeBtn = screen.getByText('完成設定');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders live telemetry and AI costing info when engineMode is firebase_live', () => {
    const mockUsageStats = {
      durationSeconds: 125,
      audioTokens: 3500,
      outputTokens: 420,
      totalTokens: 3920,
      estimatedCostUsd: 0.00315,
      modelUsed: 'gemini-3.1-flash-live-preview',
    };

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={true}
        onToggleEnabled={vi.fn()}
        engineMode="firebase_live"
        onSelectEngineMode={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        isNanoAvailable={false}
        status="listening"
        liveUsageStats={mockUsageStats}
      />
    );

    expect(screen.getByTestId('live-telemetry-section')).toBeInTheDocument();
    expect(screen.getByText(/2分 5秒/)).toBeInTheDocument();
    expect(screen.getByText(/3,500 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/420 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/\$0.0032/)).toBeInTheDocument();
    expect(screen.getByText(/Free Tier 合資格/)).toBeInTheDocument();
  });
});

