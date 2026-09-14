import React, { useState } from 'react';
import './LiveSubtitleOverlay.css';

const LANGUAGE_LABELS = {
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'es': 'Español',
};

export default function LiveSubtitleOverlay({
  active = false,
  originalText = '',
  sourceLang = 'zh-HK',
  currentTranslation = '',
  translations = {},
  selectedLanguage = 'zh-Hant',
  onSelectLanguage,
  displayMode = 'bilingual', // 'bilingual' | 'translation' | 'original'
  onSelectDisplayMode,
  fontSize = 'medium', // 'small' | 'medium' | 'large'
  onSelectFontSize,
  isVisible = true,
  onToggleVisible,
  isDocked = false, // true when docked inside TeacherScreenViewerModal
  engine = 'server',
}) {
  const [isMinimized, setIsMinimized] = useState(false);

  if (!active || !isVisible) {
    if (active && !isVisible) {
      // Floating button to re-open subtitles
      return (
        <button
          className="subtitle-reopen-pill"
          onClick={() => onToggleVisible?.(true)}
          title="顯示即時字幕 (Show Subtitles)"
          aria-label="Show Subtitles"
        >
          <span className="subtitle-indicator-dot" />
          💬 即時字幕
        </button>
      );
    }
    return null;
  }

  // Available target languages from translations object
  const availableLangs = Object.keys(translations).length > 0
    ? Object.keys(translations)
    : ['zh-Hant', 'en'];

  const fontClass = `font-${fontSize}`;

  return (
    <div
      className={`live-subtitle-container ${isDocked ? 'docked' : 'floating'} ${fontClass}`}
      role="region"
      aria-label="Live Classroom Subtitles"
    >
      <div className="subtitle-header">
        <div className="subtitle-badge">
          <span className="live-pulse-dot" />
          <span className="badge-text">LIVE CC</span>
          <span className="engine-tag" title={engine === 'client' ? 'On-Device LiteRT Whisper' : 'Cloud Gemini AI'}>
            {engine === 'client' ? '🟢 LiteRT' : '🟣 Gemini'}
          </span>
        </div>

        <div className="subtitle-toolbar">
          {/* Language Selector */}
          {onSelectLanguage && (
            <select
              className="subtitle-lang-select"
              value={selectedLanguage}
              onChange={(e) => onSelectLanguage(e.target.value)}
              title="選擇字幕語言 (Choose Language)"
              aria-label="Select Subtitle Language"
            >
              {availableLangs.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang] || lang}
                </option>
              ))}
            </select>
          )}

          {/* Mode Switcher: Bilingual / Translation / Original */}
          {onSelectDisplayMode && (
            <div className="subtitle-mode-group" role="group" aria-label="Display Mode">
              <button
                type="button"
                className={`mode-btn ${displayMode === 'bilingual' ? 'active' : ''}`}
                onClick={() => onSelectDisplayMode('bilingual')}
                title="雙語 (Bilingual)"
              >
                雙語
              </button>
              <button
                type="button"
                className={`mode-btn ${displayMode === 'translation' ? 'active' : ''}`}
                onClick={() => onSelectDisplayMode('translation')}
                title="僅翻譯 (Translation Only)"
              >
                翻譯
              </button>
              <button
                type="button"
                className={`mode-btn ${displayMode === 'original' ? 'active' : ''}`}
                onClick={() => onSelectDisplayMode('original')}
                title="僅原音 (Original Speech Only)"
              >
                原音
              </button>
            </div>
          )}

          {/* Font Size Toggle */}
          {onSelectFontSize && (
            <div className="subtitle-font-group" role="group" aria-label="Font Size">
              <button
                type="button"
                className={`font-btn ${fontSize === 'small' ? 'active' : ''}`}
                onClick={() => onSelectFontSize('small')}
                title="小字體"
              >
                A-
              </button>
              <button
                type="button"
                className={`font-btn ${fontSize === 'medium' ? 'active' : ''}`}
                onClick={() => onSelectFontSize('medium')}
                title="中字體"
              >
                A
              </button>
              <button
                type="button"
                className={`font-btn ${fontSize === 'large' ? 'active' : ''}`}
                onClick={() => onSelectFontSize('large')}
                title="大字體"
              >
                A+
              </button>
            </div>
          )}

          {/* Minimize / Close */}
          <button
            type="button"
            className="subtitle-icon-btn"
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? '展開字幕' : '最小化字幕'}
            aria-label={isMinimized ? 'Expand Subtitles' : 'Minimize Subtitles'}
          >
            {isMinimized ? '🔼' : '🔽'}
          </button>
          {onToggleVisible && (
            <button
              type="button"
              className="subtitle-icon-btn close-btn"
              onClick={() => onToggleVisible(false)}
              title="隱藏字幕"
              aria-label="Hide Subtitles"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!isMinimized && (
        <div className="subtitle-body">
          {/* Top Line: Original Spoken Cantonese (Whisper) */}
          {(displayMode === 'bilingual' || displayMode === 'original') && (
            <p className="subtitle-original-line">
              <span className="lang-tag">粵語</span>
              <span className="text-content">
                {originalText || '（老師正在講解中，等待語音...）'}
              </span>
            </p>
          )}

          {/* Bottom Line: Translated Subtitle */}
          {(displayMode === 'bilingual' || displayMode === 'translation') && (
            <p className="subtitle-translated-line">
              <span className="lang-tag target-tag">
                {LANGUAGE_LABELS[selectedLanguage] || selectedLanguage}
              </span>
              <span className="text-content">
                {currentTranslation || (originalText ? '（翻譯中...）' : '（等待語音翻譯...）')}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
