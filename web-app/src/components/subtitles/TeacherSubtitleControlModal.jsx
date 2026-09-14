import React from 'react';
import './TeacherSubtitleControlModal.css';

const AVAILABLE_LANGUAGES = [
  { code: 'zh-Hant', label: '繁體中文 (Traditional Chinese)' },
  { code: 'en', label: 'English' },
  { code: 'zh-Hans', label: '简体中文 (Simplified Chinese)' },
  { code: 'ja', label: '日本語 (Japanese)' },
  { code: 'ko', label: '한국어 (Korean)' },
];

export default function TeacherSubtitleControlModal({
  isOpen,
  onClose,
  enabled,
  onToggleEnabled,
  engineMode,
  onSelectEngineMode,
  speechLanguage,
  onSelectSpeechLanguage,
  targetLanguages,
  onToggleTargetLanguage,
  isNanoAvailable,
  latestTranscript,
  latestTranslations = {},
  status,
  error,
  liveUsageStats,
}) {
  if (!isOpen) return null;

  return (
    <div className="teacher-subtitle-modal-backdrop" onClick={onClose}>
      <div
        className="teacher-subtitle-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtitle-modal-title"
      >
        <div className="modal-header">
          <div className="title-group">
            <span className="modal-icon">🎙️</span>
            <h3 id="subtitle-modal-title">即時課堂字幕與多語言翻譯設定 (Live Subtitles)</h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Main Broadcast Switch */}
          <div className="control-section broadcast-toggle-section">
            <div className="section-label-group">
              <span className="section-title">課堂字幕廣播狀態</span>
              <span className="section-desc">
                開啟後，將向所有觀看課堂的學生即時廣播雙語課堂字幕。
              </span>
            </div>
            <button
              type="button"
              className={`toggle-broadcast-btn ${enabled ? 'active' : ''}`}
              onClick={onToggleEnabled}
            >
              {enabled ? '🔴 停止廣播字幕' : '🟢 開始廣播字幕'}
            </button>
          </div>

          {/* Model Selection (Client vs Server) */}
          <div className="control-section">
            <span className="section-title">🤖 翻譯模型選擇 (Model Architecture)</span>
            <span className="section-desc">
              語音識別 (STT) 統一使用本機 LiteRT Whisper，精準識別廣東話口語及英文程式碼術語。
            </span>

            <div className="engine-card-group">
              <label
                className={`engine-card ${engineMode === 'client' ? 'selected' : ''}`}
              >
                <div className="engine-card-header">
                  <input
                    type="radio"
                    name="engineMode"
                    value="client"
                    checked={engineMode === 'client'}
                    onChange={() => onSelectEngineMode('client')}
                  />
                  <span className="engine-badge client-badge">🟢 Client Model (本機端)</span>
                </div>
                <div className="engine-card-body">
                  <strong>Chrome Built-in AI (Gemini Nano)</strong>
                  <p>100% 本機端翻譯，零延遲（~50ms）、$0 雲端成本、不消耗課堂 AI 額度。</p>
                  <span className="nano-status">
                    {isNanoAvailable ? '✅ 本機 Gemini Nano 已就緒' : 'ℹ️ 建議 Chrome 138+ / Edge 148+'}
                  </span>
                </div>
              </label>

              <label
                className={`engine-card ${engineMode === 'server' ? 'selected' : ''}`}
              >
                <div className="engine-card-header">
                  <input
                    type="radio"
                    name="engineMode"
                    value="server"
                    checked={engineMode === 'server'}
                    onChange={() => onSelectEngineMode('server')}
                  />
                  <span className="engine-badge server-badge">🟣 Server Model (雲端端)</span>
                </div>
                <div className="engine-card-body">
                  <strong>Cloud Functions (Gemini 2.5 Flash)</strong>
                  <p>高精確度多語言同步輸出，完整保留程式語言語法與專業技術名詞。</p>
                  <span className="server-status">⚡ 支援所有瀏覽器</span>
                </div>
              </label>

              <label
                className={`engine-card ${engineMode === 'firebase_live' ? 'selected' : ''}`}
              >
                <div className="engine-card-header">
                  <input
                    type="radio"
                    name="engineMode"
                    value="firebase_live"
                    checked={engineMode === 'firebase_live'}
                    onChange={() => onSelectEngineMode('firebase_live')}
                  />
                  <span className="engine-badge live-badge">🔴 Gemini Live (雙向串流)</span>
                </div>
                <div className="engine-card-body">
                  <strong>Firebase AI Logic (Gemini Live)</strong>
                  <p>雙向音訊 WebSocket 串流，超低延遲逐字出現，雲端即時辨識與翻譯。</p>
                  <span className="live-status">⚡ WebSocket · 免本地 GPU</span>
                </div>
              </label>
            </div>
          </div>

          {/* Gemini Live Telemetry & AI Costing Strip */}
          {engineMode === 'firebase_live' && (
            <div className="control-section live-telemetry-section" data-testid="live-telemetry-section">
              <span className="section-title">📊 即時串流用量與成本監控 (Live Stream Costing Telemetry)</span>
              <div className="live-telemetry-card">
                <div className="telemetry-grid">
                  <div className="telemetry-item">
                    <span className="telemetry-label">⏱️ 串流時長</span>
                    <span className="telemetry-value">
                      {liveUsageStats?.durationSeconds
                        ? `${Math.floor(liveUsageStats.durationSeconds / 60)}分 ${liveUsageStats.durationSeconds % 60}秒`
                        : enabled ? '0分 0秒 (連線中)' : '0分 0秒'}
                    </span>
                  </div>
                  <div className="telemetry-item">
                    <span className="telemetry-label">🎙️ 音訊輸入 Tokens</span>
                    <span className="telemetry-value">
                      {liveUsageStats?.audioTokens
                        ? `${liveUsageStats.audioTokens.toLocaleString()} tokens`
                        : '0 tokens'}
                    </span>
                  </div>
                  <div className="telemetry-item">
                    <span className="telemetry-label">📝 字幕輸出 Tokens</span>
                    <span className="telemetry-value">
                      {liveUsageStats?.outputTokens
                        ? `${liveUsageStats.outputTokens.toLocaleString()} tokens`
                        : '0 tokens'}
                    </span>
                  </div>
                  <div className="telemetry-item highlight-cost">
                    <span className="telemetry-label">💰 預估成本 (USD)</span>
                    <span className="telemetry-value">
                      {liveUsageStats?.estimatedCostUsd
                        ? `$${liveUsageStats.estimatedCostUsd.toFixed(4)}`
                        : '$0.0000'}
                    </span>
                    <span className="telemetry-badge">Free Tier 合資格</span>
                  </div>
                </div>
                <div className="telemetry-note">
                  💡 計費標準：音訊輸入 ~$0.60/1M tokens (約 28 tokens/秒)，文字輸出 ~$2.50/1M tokens。停用音訊回傳合成 ($18/1M)。單次 60 分鐘課堂預估成本約 $0.06 - $0.10 USD。
                </div>
              </div>
            </div>
          )}

          {/* Spoken Language */}
          <div className="control-section">
            <label className="section-title" htmlFor="speech-lang-select">
              🗣️ 老師發音語言 (Spoken Speech Language)
            </label>
            <select
              id="speech-lang-select"
              className="speech-lang-select"
              value={speechLanguage}
              onChange={(e) => onSelectSpeechLanguage(e.target.value)}
            >
              <option value="zh-HK">粵語 / 廣東話 (Cantonese zh-HK) + 英文術語混合</option>
              <option value="en-US">English (US)</option>
              <option value="zh-CN">普通話 (Mandarin zh-CN)</option>
              <option value="ja">日本語 (Japanese)</option>
            </select>
          </div>

          {/* Target Languages */}
          <div className="control-section">
            <span className="section-title">🌐 目標翻譯語言 (Target Broadcast Languages)</span>
            <div className="target-lang-grid">
              {AVAILABLE_LANGUAGES.map(({ code, label }) => {
                const checked = targetLanguages.includes(code);
                return (
                  <label key={code} className="target-lang-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleTargetLanguage(code)}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Live Preview Ticker */}
          {enabled && (
            <div className="control-section live-preview-section">
              <span className="section-title">👀 老師即時預覽 (Live Ticker)</span>
              <div className="live-preview-box">
                <div className="preview-row">
                  <span className="preview-tag">原音識別:</span>
                  <span className="preview-text">
                    {latestTranscript || '（正在聆聽說話...）'}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-tag target">翻譯預覽:</span>
                  <span className="preview-text translated">
                    {latestTranslations?.['zh-Hant'] ||
                     latestTranslations?.['en'] ||
                     Object.values(latestTranslations || {})[0] ||
                     (latestTranscript ? '（翻譯處理中...）' : '（等待說話...）')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-alert">⚠️ {error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="footer-btn primary" onClick={onClose}>
            完成設定
          </button>
        </div>
      </div>
    </div>
  );
}
