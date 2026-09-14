import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveSubtitleOverlay from './LiveSubtitleOverlay';

describe('LiveSubtitleOverlay Component', () => {
  it('renders nothing when active is false', () => {
    const { container } = render(
      <LiveSubtitleOverlay active={false} originalText="Hello" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders reopen pill when active is true but isVisible is false', () => {
    const onToggleVisible = vi.fn();
    render(
      <LiveSubtitleOverlay
        active={true}
        isVisible={false}
        onToggleVisible={onToggleVisible}
      />
    );

    const reopenBtn = screen.getByRole('button', { name: /Show Subtitles/i });
    expect(reopenBtn).toBeInTheDocument();

    fireEvent.click(reopenBtn);
    expect(onToggleVisible).toHaveBeenCalledWith(true);
  });

  it('renders dual lines in bilingual mode with engine badge', () => {
    render(
      <LiveSubtitleOverlay
        active={true}
        isVisible={true}
        engine="client"
        displayMode="bilingual"
        originalText="今日我哋做 React lab"
        currentTranslation="今天我們進行 React 實驗"
        selectedLanguage="zh-Hant"
      />
    );

    expect(screen.getByText('LIVE CC')).toBeInTheDocument();
    expect(screen.getByText(/LiteRT/i)).toBeInTheDocument();
    expect(screen.getByText('今日我哋做 React lab')).toBeInTheDocument();
    expect(screen.getByText('今天我們進行 React 實驗')).toBeInTheDocument();
  });

  it('handles display mode toggles and font changes', () => {
    const onSelectDisplayMode = vi.fn();
    const onSelectFontSize = vi.fn();
    const onSelectLanguage = vi.fn();

    render(
      <LiveSubtitleOverlay
        active={true}
        isVisible={true}
        displayMode="bilingual"
        fontSize="medium"
        onSelectDisplayMode={onSelectDisplayMode}
        onSelectFontSize={onSelectFontSize}
        onSelectLanguage={onSelectLanguage}
        translations={{ 'zh-Hant': '繁中', 'en': 'Eng' }}
      />
    );

    // Switch to translation only
    const transOnlyBtn = screen.getByRole('button', { name: '翻譯' });
    fireEvent.click(transOnlyBtn);
    expect(onSelectDisplayMode).toHaveBeenCalledWith('translation');

    // Switch font
    const largeFontBtn = screen.getByRole('button', { name: 'A+' });
    fireEvent.click(largeFontBtn);
    expect(onSelectFontSize).toHaveBeenCalledWith('large');

    // Change language
    const langSelect = screen.getByRole('combobox', { name: /Select Subtitle Language/i });
    fireEvent.change(langSelect, { target: { value: 'en' } });
    expect(onSelectLanguage).toHaveBeenCalledWith('en');
  });

  it('hides original line in translation-only mode', () => {
    render(
      <LiveSubtitleOverlay
        active={true}
        isVisible={true}
        displayMode="translation"
        originalText="粵語句子"
        currentTranslation="Translated Line Only"
      />
    );

    expect(screen.queryByText('粵語句子')).not.toBeInTheDocument();
    expect(screen.getByText('Translated Line Only')).toBeInTheDocument();
  });
});
