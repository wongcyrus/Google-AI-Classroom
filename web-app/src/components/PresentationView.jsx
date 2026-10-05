import { useState, useRef, useEffect } from 'react';
import './PresentationView.css';

const PresentationView = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const iframeRef = useRef(null);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.warn('[PresentationView] Fullscreen toggle error:', err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div className={`presentation-view-container ${isFullscreen ? 'is-fullscreen' : ''}`} ref={containerRef}>
      <header className="presentation-toolbar">
        <div className="presentation-title-group">
          <span className="presentation-badge">📽️ SLIDE DECK</span>
          <h2 className="presentation-heading">Google AI Classroom Architecture Presentation</h2>
          <span className="presentation-subtext">Google Cloud Tech Talk · ISATE 2026</span>
        </div>

        <div className="presentation-actions">
          <button
            type="button"
            className="pres-btn pres-btn-primary"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen Presentation Mode'}
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? '⏹️ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>

          <a
            href="/google-cloud-slides.html"
            target="_blank"
            rel="noopener noreferrer"
            className="pres-btn pres-btn-secondary"
            title="Open Interactive HTML Slides in New Tab"
            aria-label="Open in New Tab"
          >
            ↗️ New Tab
          </a>

          <a
            href="/google-cloud-slides.pdf"
            download="Google-AI-Classroom-Slides.pdf"
            className="pres-btn pres-btn-outline"
            title="Download PDF Slide Deck"
            aria-label="Download PDF"
          >
            📥 PDF
          </a>

          <a
            href="/google-cloud-slides.pptx"
            download="Google-AI-Classroom-Slides.pptx"
            className="pres-btn pres-btn-outline"
            title="Download Microsoft PowerPoint PPTX Deck"
            aria-label="Download PPTX"
          >
            📊 PPTX
          </a>

          <button
            type="button"
            className={`pres-btn pres-btn-outline ${showNotes ? 'active' : ''}`}
            onClick={() => setShowNotes(!showNotes)}
            title="Toggle Speaker Guide & Presentation Info"
            aria-label="Toggle Speaker Notes"
          >
            📋 Guide
          </button>
        </div>
      </header>

      {showNotes && (
        <aside className="presentation-notes-drawer" role="complementary" aria-label="Speaker Guide">
          <div className="notes-header">
            <h3>🎙️ Presentation Key Topics & Structure</h3>
            <button
              type="button"
              className="notes-close-btn"
              onClick={() => setShowNotes(false)}
              aria-label="Close Guide"
            >
              ✕
            </button>
          </div>
          <div className="notes-body">
            <div className="notes-card">
              <h4>🎯 10 Thematic Modules</h4>
              <ul>
                <li><strong>01 | The Real-Time Invigilation & Assessment Challenge:</strong> Privacy-preserving edge AI vs. spyware.</li>
                <li><strong>02 | 4-Tier Hybrid Cloud Architecture:</strong> Google Cloud Run, Firestore single-stream, GCIP blocking functions.</li>
                <li><strong>03 | Gemini Enterprise Agent Platform:</strong> 100% Gemini 3 family routing, Genkit self-healing, prompt management studio.</li>
                <li><strong>04 | On-Device Edge Vision & Speech AI:</strong> MediaPipe 468-point mesh, LiteRT Whisper & Gemma Web Workers.</li>
                <li><strong>05 | Zero-Trust Assessment Security & Passkeys:</strong> Live exam mode, WebAuthn FIDO2 1-phone hardware lock, dynamic rotating QRs.</li>
                <li><strong>06 | Real-Time Media & Student Hub:</strong> Pure frame classroom broadcaster, YouTube-style dual captions, readiness wizard.</li>
                <li><strong>07 | Serverless Map-Reduce-Map Video Intelligence:</strong> Async fan-out video analysis, automated rubric synthesis.</li>
                <li><strong>08 | Green AI & Cloud FinOps:</strong> 99.8% cost reduction ($0.85/exam vs $750 SaaS), incident dossier generator.</li>
                <li><strong>09 | DevSecOps & Production Reliability:</strong> 1,580+ automated tests across 4 pyramid tiers, strict zero-trust Firestore rules.</li>
                <li><strong>10 | Open Source & Empowering Education:</strong> Live demonstration, hands-on student/teacher portal.</li>
              </ul>
            </div>
            <div className="notes-card">
              <h4>⌨️ Presentation Keyboard Shortcuts</h4>
              <p>When the presentation iframe is focused:</p>
              <ul>
                <li><kbd>→</kbd> / <kbd>Space</kbd>: Next Slide</li>
                <li><kbd>←</kbd>: Previous Slide</li>
                <li><kbd>F</kbd>: Fullscreen inside Marp slide engine</li>
              </ul>
            </div>
          </div>
        </aside>
      )}

      <main className="presentation-frame-viewport">
        {loading && (
          <div className="presentation-loading-indicator" aria-live="polite">
            <div className="pres-spinner" />
            <span>Loading interactive slide deck...</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src="/google-cloud-slides.html"
          title="Google AI Classroom Interactive Presentation"
          className="presentation-iframe"
          onLoad={() => setLoading(false)}
          allow="fullscreen; autoplay"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </main>
    </div>
  );
};

export default PresentationView;
