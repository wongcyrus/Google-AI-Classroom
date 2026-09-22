import React, { useState, useRef, useEffect } from 'react';
import PropertiesWidget from './PropertiesWidget';
import AlertsWidget from './AlertsWidget';
import MessagesWidget from './MessagesWidget';

const Sidebar = ({
  classProperties,
  myProperties,
  recentIrregularities,
  ipAddress,
  recentMessages,
  liveTranscriptHistory = [],
  currentOriginalText = '',
  currentTranslationText = '',
  selectedLanguage = 'en',
  activeTab: externalTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState('all'); // 'all' | 'transcript' | 'properties' | 'alerts'
  const activeTab = externalTab !== undefined ? externalTab : internalTab;
  const transcriptEndRef = useRef(null);

  const handleTabClick = (tab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  // Auto-scroll transcript container to newest sentence
  useEffect(() => {
    if (activeTab === 'transcript' || activeTab === 'all') {
      if (typeof transcriptEndRef.current?.scrollIntoView === 'function') {
        transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [liveTranscriptHistory, currentOriginalText, currentTranslationText, activeTab]);

  return (
    <div className="student-view-sidebar">
      {/* YouTube-Style Sidebar Navigation Tabs */}
      <div className="sidebar-tabs-nav" role="tablist" aria-label="Student Information Panels">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          className={`sidebar-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => handleTabClick('all')}
          title="Show All Sidebar Panels"
        >
          📑 All Panels
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'transcript'}
          className={`sidebar-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
          onClick={() => handleTabClick('transcript')}
          title="Live Lecture Transcript"
        >
          💬 Transcript
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'properties'}
          className={`sidebar-tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
          onClick={() => handleTabClick('properties')}
          title="Classroom & Device Properties"
        >
          📋 Class Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'alerts'}
          className={`sidebar-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => handleTabClick('alerts')}
          title="Alerts and Instructor Messages"
        >
          🔔 Alerts
        </button>
      </div>

      {/* Panel 1: Live Transcript Stream (YouTube Live Chat/Transcript Style) */}
      <div
        className="sidebar-tab-panel transcript-panel"
        style={{ display: activeTab === 'transcript' || activeTab === 'all' ? 'flex' : 'none' }}
      >
        <div className="transcript-panel-header">
          <div className="transcript-header-title">
            <span className="live-pulse-dot" />
            <strong>💬 Live Lecture Transcript</strong>
          </div>
          <span className="transcript-count-badge">
            {liveTranscriptHistory.length + (currentOriginalText ? 1 : 0)} entries
          </span>
        </div>

        <div className="transcript-scroll-area" role="log" aria-live="polite">
          {liveTranscriptHistory.length === 0 && !currentOriginalText && !currentTranslationText ? (
            <div className="transcript-empty-placeholder">
              <span className="placeholder-icon">🎙️</span>
              <p className="placeholder-text">Listening for instructor lecture speech...</p>
              <span className="placeholder-subtext">Live captions & translations will log here automatically.</span>
            </div>
          ) : (
            <>
              {liveTranscriptHistory.map((item, idx) => (
                <div key={item.id || item.timestamp || idx} className="transcript-entry">
                  <div className="transcript-meta">
                    <span className="transcript-time">
                      {item.time || (item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Now')}
                    </span>
                    {item.speaker && <span className="transcript-speaker">{item.speaker}</span>}
                  </div>
                  {item.original && (
                    <div className="transcript-original-bubble">
                      <span className="transcript-text">{item.original}</span>
                    </div>
                  )}
                  {item.translation && (
                    <div className="transcript-translation-bubble">
                      <span className="transcript-badge-lang">{item.lang || selectedLanguage}</span>
                      <span className="transcript-translation-text">{item.translation}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Current in-flight speech sentence */}
              {(currentOriginalText || currentTranslationText) && (
                <div className="transcript-entry current-inflight">
                  <div className="transcript-meta">
                    <span className="live-pulse-dot" />
                    <span className="transcript-time">Speaking now</span>
                  </div>
                  {currentOriginalText && (
                    <div className="transcript-original-bubble current">
                      <span className="transcript-text">{currentOriginalText}</span>
                    </div>
                  )}
                  {currentTranslationText && (
                    <div className="transcript-translation-bubble current">
                      <span className="transcript-badge-lang">{selectedLanguage}</span>
                      <span className="transcript-translation-text highlight">{currentTranslationText}</span>
                    </div>
                  )}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Panel 2: Class & Student Properties */}
      <div
        className="sidebar-tab-panel"
        style={{ display: activeTab === 'properties' || activeTab === 'all' ? 'block' : 'none' }}
      >
        <PropertiesWidget classProperties={classProperties} myProperties={myProperties} />
      </div>

      {/* Panel 3: Alerts & Messages */}
      <div
        className="sidebar-tab-panel"
        style={{ display: activeTab === 'alerts' || activeTab === 'all' ? 'flex' : 'none', flexDirection: 'column', gap: '1rem' }}
      >
        <AlertsWidget recentIrregularities={recentIrregularities} ipAddress={ipAddress} />
        <MessagesWidget recentMessages={recentMessages} />
      </div>
    </div>
  );
};

export default Sidebar;
