import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TeacherSubtitleControlModal from './TeacherSubtitleControlModal';
import { acquireInputDeviceStream } from '../../utils/mediaDeviceCapture';

vi.mock('../../utils/mediaDeviceCapture', () => ({
  acquireInputDeviceStream: vi.fn().mockRejectedValue(new Error('Microphone not available')),
}));

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

    expect(screen.getByText(/Live Classroom Subtitles & Multilingual Translation/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Subtitle Broadcast/i)).toBeInTheDocument();

    // Toggle broadcast
    const broadcastBtn = screen.getByText(/Start Subtitle Broadcast/i);
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
    const speechSelect = screen.getByLabelText(/Spoken Speech Language/i);
    fireEvent.change(speechSelect, { target: { value: 'en-US' } });
    expect(onSelectSpeechLanguage).toHaveBeenCalledWith('en-US');

    // Toggle target language
    const jaCheckbox = screen.getByLabelText(/Japanese/i);
    fireEvent.click(jaCheckbox);
    expect(onToggleTargetLanguage).toHaveBeenCalledWith('ja');

    // Close button
    const closeBtn = screen.getByText('Save & Close');
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
    expect(screen.getByText(/2m 5s/)).toBeInTheDocument();
    expect(screen.getByText(/3,500 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/420 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/\$0.0032/)).toBeInTheDocument();
    expect(screen.getAllByText(/Free Tier Eligible/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders warning banner and 1-click switch button when client mode is selected without Nano', () => {
    const onSelectEngineMode = vi.fn();

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="client"
        onSelectEngineMode={onSelectEngineMode}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        isNanoAvailable={false}
        status="idle"
      />
    );

    expect(screen.getByTestId('nano-warning-banner')).toBeInTheDocument();
    expect(screen.getByText(/Chrome Built-in AI \(Gemini Nano\) is unavailable/i)).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: /Switch to Recommended Server Model/i });
    fireEvent.click(switchBtn);
    expect(onSelectEngineMode).toHaveBeenCalledWith('server');
  });

  it('renders language readiness pills and client fallback note in client mode', () => {
    const mockPairStatuses = {
      en: { status: 'readily', baseSource: 'zh', baseTarget: 'en' },
      ja: { status: 'after-download', baseSource: 'zh', baseTarget: 'ja' },
      'zh-Hant': { status: 'unsupported', baseSource: 'zh', baseTarget: 'zh' },
    };

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="client"
        onSelectEngineMode={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en', 'ja', 'zh-Hant']}
        onToggleTargetLanguage={vi.fn()}
        isNanoAvailable={true}
        languagePairStatuses={mockPairStatuses}
      />
    );

    expect(screen.getByTestId('pair-pill-en')).toHaveTextContent('Ready');
    expect(screen.getByTestId('pair-pill-ja')).toHaveTextContent('Download Required');
    expect(screen.getByTestId('pair-pill-zh-Hant')).toHaveTextContent('Cloud Fallback');
    expect(screen.getByText(/Client mode: Supported languages are translated on-device/)).toBeInTheDocument();
  });

  it('renders microphone selection dropdown and triggers onSelectMicDeviceId', async () => {
    const mockDevices = [
      { deviceId: 'mic-builtin', label: 'Built-in Audio Input', kind: 'audioinput' },
      { deviceId: 'mic-usb', label: 'USB Wireless Lavalier Mic', kind: 'audioinput' },
    ];

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const onSelectMicDeviceId = vi.fn();

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="server"
        onSelectEngineMode={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        selectedMicDeviceId="mic-builtin"
        onSelectMicDeviceId={onSelectMicDeviceId}
      />
    );

    expect(screen.getByLabelText(/Audio Input \(Microphone\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Live Input Level/i)).toBeInTheDocument();

    await screen.findByText('USB Wireless Lavalier Mic');

    const micSelect = screen.getByLabelText(/Select Microphone/i);
    expect(micSelect).toBeInTheDocument();

    fireEvent.change(micSelect, { target: { value: 'mic-usb' } });
    expect(onSelectMicDeviceId).toHaveBeenCalledWith('mic-usb');
  });

  it('renders configured course discipline and translation AI prompt preview', () => {
    const mockPrompt = {
      id: 'p-123',
      name: 'Nursing & Medical Clinical Translation',
      promptText: 'Preserve clinical pharmacology terminology and standard hospital triage codes.',
    };

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="server"
        onSelectEngineMode={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        courseContext="Healthcare, Nursing & Medical Sciences"
        subtitlePrompt={mockPrompt}
      />
    );

    expect(screen.getByText(/Course Subject Domain & Translation AI Prompt/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Healthcare, Nursing & Medical Sciences/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Nursing & Medical Clinical Translation/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Preserve clinical pharmacology terminology/i)).toBeInTheDocument();
  });

  it('allows teacher to configure subject domain and select translation prompt from library', () => {
    const onSelectCourseContext = vi.fn();
    const onSelectSubtitlePrompt = vi.fn();
    const mockPrompts = [
      {
        id: 'p-1',
        name: 'Cloud Gemini Batch Subtitle Translator',
        promptText: 'Translate accurately for technical terms.',
      },
      {
        id: 'prompt-2',
        name: 'Prompt Two',
        promptText: 'Prompt Two Text',
      },
    ];

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="server"
        onSelectEngineMode={vi.fn()}
        speechLanguage="en-US"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['zh-Hant']}
        onToggleTargetLanguage={vi.fn()}
        courseContext="Computer Science & Software Development"
        subtitlePrompt={mockPrompts[0]}
        availablePrompts={mockPrompts}
        onSelectCourseContext={onSelectCourseContext}
        onSelectSubtitlePrompt={onSelectSubtitlePrompt}
      />
    );

    // 1. Change course subject domain
    const domainSelect = screen.getByLabelText(/Course Subject Domain/i);
    fireEvent.change(domainSelect, { target: { value: 'Business, Finance & Accounting' } });
    expect(onSelectCourseContext).toHaveBeenCalledWith('Business, Finance & Accounting');

    // 2. Select different prompt from library
    const promptSelect = screen.getByLabelText(/Translation AI Prompt/i);
    fireEvent.change(promptSelect, { target: { value: 'prompt-2' } });
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(mockPrompts[1]);

    fireEvent.change(promptSelect, { target: { value: '' } });
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(null);

    // 3. Edit prompt inline and toggle editor
    const editBtn = screen.getByText(/✏️ Edit Prompt/i);
    fireEvent.click(editBtn);
    expect(screen.getByText('Close Editor')).toBeInTheDocument();

    const textarea = screen.getByLabelText(/Edit Translation Prompt Instructions/i);
    fireEvent.change(textarea, { target: { value: 'Custom medical glossaries here' } });

    const applyBtn = screen.getByText(/Apply Custom Instructions/i);
    fireEvent.click(applyBtn);

    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        promptText: 'Custom medical glossaries here',
      })
    );

    // 4. Reset to default button
    const resetBtn = screen.getByText(/Reset to Default/i);
    fireEvent.click(resetBtn);
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(null);
  });

  it('allows switching between server and live engines, and provides fallback button when nano unavailable', () => {
    const onSelectEngineMode = vi.fn();

    const { rerender } = render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        engineMode="client"
        isNanoAvailable={false}
        onSelectEngineMode={onSelectEngineMode}
        selectedMicDeviceId="mic-1"
        onSelectMicDeviceId={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        subtitlePrompt={null}
        prompts={[]}
        onSelectSubtitlePrompt={vi.fn()}
        courseContext="Computer Science & IT"
        onSelectCourseContext={vi.fn()}
      />
    );

    // Nano warning banner is shown with recommendation button
    const switchRecommendedBtn = screen.getByRole('button', { name: /Switch to Recommended Server Model/i });
    fireEvent.click(switchRecommendedBtn);
    expect(onSelectEngineMode).toHaveBeenCalledWith('server');

    // Switch to firebase_live radio
    const liveRadio = document.querySelector('input[value="firebase_live"]');
    fireEvent.click(liveRadio);
    expect(onSelectEngineMode).toHaveBeenCalledWith('firebase_live');

    // Switch to server radio
    const serverRadio = document.querySelector('input[value="server"]');
    fireEvent.click(serverRadio);
    expect(onSelectEngineMode).toHaveBeenCalledWith('server');
  });

  it('supports prompt editing, custom instructions draft application, and domain selection', () => {
    const onSelectCourseContext = vi.fn();
    const onSelectSubtitlePrompt = vi.fn();

    const mockPrompt = {
      id: 'p_1',
      name: 'Cloud Computing Terms',
      promptText: 'Translate accurately with AWS and Docker terminology.',
    };

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        onToggleEnabled={vi.fn()}
        engineMode="server"
        onSelectEngineMode={vi.fn()}
        selectedMicDeviceId="mic-1"
        onSelectMicDeviceId={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        subtitlePrompt={mockPrompt}
        prompts={[mockPrompt]}
        onSelectSubtitlePrompt={onSelectSubtitlePrompt}
        courseContext="Computer Science & Software Development"
        onSelectCourseContext={onSelectCourseContext}
      />
    );

    // Change discipline domain
    const domainSelect = screen.getByLabelText('Course Subject Domain');
    fireEvent.change(domainSelect, { target: { value: 'Business, Finance & Accounting' } });
    expect(onSelectCourseContext).toHaveBeenCalledWith('Business, Finance & Accounting');

    // Open prompt editor
    const editPromptBtn = screen.getByRole('button', { name: /✏️ Edit Prompt/i });
    fireEvent.click(editPromptBtn);

    // Edit textarea
    const textarea = screen.getByLabelText('Edit Translation Prompt Instructions');
    fireEvent.change(textarea, { target: { value: 'Translate accurately with Kubernetes and Istio terminology.' } });

    // Apply custom instructions
    const applyBtn = screen.getByRole('button', { name: /Apply Custom Instructions/i });
    fireEvent.click(applyBtn);

    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p_1',
        promptText: 'Translate accurately with Kubernetes and Istio terminology.',
      })
    );

    // Reset to default
    const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
    fireEvent.click(resetBtn);
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(null);
  });

  it('renders live preview ticker, selects prompt from dropdown, displays errors and saves modal', () => {
    const onClose = vi.fn();
    const onSelectSubtitlePrompt = vi.fn();

    const mockPrompts = [
      { id: 'p_docker', name: 'Docker & Containers Prompt', promptText: 'Focus on containerization.' },
    ];

    render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={onClose}
        enabled={true}
        onToggleEnabled={vi.fn()}
        engineMode="server"
        onSelectEngineMode={vi.fn()}
        speechLanguage="zh-HK"
        onSelectSpeechLanguage={vi.fn()}
        targetLanguages={['en']}
        onToggleTargetLanguage={vi.fn()}
        status="listening"
        availablePrompts={mockPrompts}
        onSelectSubtitlePrompt={onSelectSubtitlePrompt}
        latestTranscript="你好 Docker"
        latestTranslations={{ en: 'Hello Docker' }}
        error="Cloud quota temporarily throttled"
      />
    );

    // Live preview ticker
    expect(screen.getByText('👀 Live Preview (Ticker)')).toBeInTheDocument();
    expect(screen.getByText('你好 Docker')).toBeInTheDocument();
    expect(screen.getByText('Hello Docker')).toBeInTheDocument();

    // Error alert
    expect(screen.getByText(/Cloud quota temporarily throttled/i)).toBeInTheDocument();

    // Prompt select dropdown
    const promptSelect = screen.getByLabelText('Translation AI Prompt');
    fireEvent.change(promptSelect, { target: { value: 'p_docker' } });
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(mockPrompts[0]);

    fireEvent.change(promptSelect, { target: { value: '' } });
    expect(onSelectSubtitlePrompt).toHaveBeenCalledWith(null);

    // Save & Close footer button
    const saveCloseBtn = screen.getByRole('button', { name: 'Save & Close' });
    fireEvent.click(saveCloseBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('sets up live microphone meter and cleans up tracks and audio context on unmount', async () => {
    const mockTrack = { stop: vi.fn() };
    const mockAudioStream = {
      getTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
    };

    acquireInputDeviceStream.mockResolvedValueOnce(mockAudioStream);

    let capturedTick = null;
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((cb) => {
      capturedTick = cb;
      return 12345;
    });
    window.cancelAnimationFrame = vi.fn();

    const mockClose = vi.fn().mockResolvedValue();
    window.AudioContext = vi.fn().mockImplementation(function () {
      return {
        state: 'running',
        createMediaStreamSource: vi.fn().mockReturnValue({
          connect: vi.fn(),
        }),
        createAnalyser: vi.fn().mockReturnValue({
          fftSize: 256,
          frequencyBinCount: 128,
          getByteFrequencyData: vi.fn((arr) => {
            arr.fill(60);
          }),
        }),
        close: mockClose,
      };
    });

    const { unmount } = render(
      <TeacherSubtitleControlModal
        isOpen={true}
        onClose={vi.fn()}
        enabled={false}
        engineMode="server"
        speechLanguage="zh-HK"
        targetLanguages={['en']}
      />
    );

    // Allow startMicMeter async promise to resolve
    await new Promise((r) => setTimeout(r, 20));

    expect(window.requestAnimationFrame).toHaveBeenCalled();
    if (capturedTick) {
      capturedTick();
    }

    // Unmount to trigger cleanup
    unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(12345);
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    delete window.AudioContext;
  });
});


