import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase-config';
import './BingoQuestionBankModal.css';

/**
 * Parses plain-text / Aiken-style quiz questions into structured MCQ array.
 */
export function parseTextQuestions(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();

  // 1. Try parsing JSON first
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(q =>
          q && q.question && Array.isArray(q.options) && q.options.length === 4 && typeof q.correctIndex === 'number'
        ).map((q, idx) => ({
          id: q.id || `q_json_${Date.now()}_${idx}`,
          question: q.question.trim(),
          options: q.options.map(o => String(o).trim()),
          correctIndex: Math.min(3, Math.max(0, q.correctIndex)),
        }));
      }
    } catch {}
  }

  // 2. Parse Aiken / line-by-line format
  // Blocks separated by blank lines or QUESTION / ANSWER patterns
  const blocks = trimmed.split(/\n\s*\n+/);
  const questions = [];

  blocks.forEach((block, bIdx) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) return; // Needs question + 4 options (and optional ANSWER)

    let questionText = lines[0].replace(/^Q\d*[:.]\s*/i, '');
    const options = [];
    let correctIndex = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Check for ANSWER: X or ANS: X
      const ansMatch = line.match(/^(?:ANSWER|ANS)[:\s]+([A-D])/i);
      if (ansMatch) {
        const letter = ansMatch[1].toUpperCase();
        correctIndex = { A: 0, B: 1, C: 2, D: 3 }[letter] ?? 0;
        continue;
      }

      // Match A) / A. / [A]
      const optMatch = line.match(/^(?:[A-D][.)\]]\s*|\[[A-D]\]\s*)(.*)/i);
      if (optMatch && options.length < 4) {
        options.push(optMatch[1].trim());
      } else if (options.length < 4 && !line.startsWith('//')) {
        options.push(line);
      }
    }

    if (options.length === 4) {
      questions.push({
        id: `q_parsed_${Date.now()}_${bIdx}`,
        question: questionText,
        options,
        correctIndex,
      });
    }
  });

  return questions;
}

export default function BingoQuestionBankModal({
  isOpen,
  onClose,
  questionBank = [],
  onSaveBank,
}) {
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'ai' | 'import'
  const [bank, setBank] = useState(questionBank);

  // Single Question Form State
  const [newQuestion, setNewQuestion] = useState('');
  const [newOptions, setNewOptions] = useState(['', '', '', '']);
  const [newCorrectIdx, setNewCorrectIdx] = useState(0);

  // AI Generator State
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiGeneratedList, setAiGeneratedList] = useState([]);
  const [selectedAiIndices, setSelectedAiIndices] = useState(new Set());
  const [aiError, setAiError] = useState(null);

  // Import State
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState([]);

  if (!isOpen) return null;

  const handleSaveAll = (updatedBank) => {
    setBank(updatedBank);
    if (onSaveBank) {
      onSaveBank(updatedBank);
    }
  };

  const handleDeleteQuestion = (idx) => {
    const updated = bank.filter((_, i) => i !== idx);
    handleSaveAll(updated);
  };

  const handleAddSingleQuestion = (e) => {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    if (newOptions.some(opt => !opt.trim())) return;

    const added = {
      id: `q_${Date.now()}`,
      question: newQuestion.trim(),
      options: newOptions.map(o => o.trim()),
      correctIndex: Number(newCorrectIdx),
    };

    const updated = [...bank, added];
    handleSaveAll(updated);

    // Reset form
    setNewQuestion('');
    setNewOptions(['', '', '', '']);
    setNewCorrectIdx(0);
  };

  // Trigger AI Question Generation
  const handleGenerateAi = async () => {
    if (!aiTopic.trim()) return;
    setIsGenerating(true);
    setAiError(null);

    try {
      const generateFn = httpsCallable(functions, 'generateQuestionBankAi');
      const res = await generateFn({ topic: aiTopic.trim(), count: Number(aiCount) });
      const questions = res.data?.questions || [];

      setAiGeneratedList(questions);
      // Select all by default
      setSelectedAiIndices(new Set(questions.map((_, idx) => idx)));
    } catch (err) {
      console.error('[BingoQuestionBankModal] AI Gen error:', err);
      setAiError(err.message || 'Failed to generate questions. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveAiQuestions = () => {
    const chosen = aiGeneratedList.filter((_, idx) => selectedAiIndices.has(idx)).map((q, i) => ({
      ...q,
      id: `q_ai_${Date.now()}_${i}`,
    }));

    const updated = [...bank, ...chosen];
    handleSaveAll(updated);
    setAiGeneratedList([]);
    setAiTopic('');
    setActiveTab('list');
  };

  // Handle Text Import
  const handlePreviewImport = (text) => {
    setImportText(text);
    const parsed = parseTextQuestions(text);
    setImportPreview(parsed);
  };

  const handleApplyImport = () => {
    if (importPreview.length === 0) return;
    const updated = [...bank, ...importPreview];
    handleSaveAll(updated);
    setImportText('');
    setImportPreview([]);
    setActiveTab('list');
  };

  const handleLoadSample = () => {
    const sample = `Which command lists all running containers in Docker?
A) docker run
B) docker ps
C) docker stop
D) docker images
ANSWER: B

What is the default port for HTTP traffic?
A) 80
B) 443
C) 22
D) 8080
ANSWER: A

Which keyword defines an asynchronous function in JavaScript?
A) defer
B) async
C) await
D) promise
ANSWER: B`;
    handlePreviewImport(sample);
  };

  return (
    <div className="bank-modal-overlay" data-testid="bank-modal-overlay">
      <div className="bank-modal-container" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="bank-modal-header">
          <div>
            <h2 className="bank-modal-title">📚 Bingo Predefined Question Bank</h2>
            <p className="bank-modal-subtitle">
              Questions in this bank run in Cost-Saving Mode ($0.00 / Zero AI tokens).
            </p>
          </div>
          <button className="bank-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="bank-tabs">
          <button
            type="button"
            className={`bank-tab-btn ${activeTab === 'list' ? 'active' : ''}`}
            onClick={() => setActiveTab('list')}
            data-testid="tab-list"
          >
            📋 Questions List ({bank.length})
          </button>
          <button
            type="button"
            className={`bank-tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
            data-testid="tab-ai"
          >
            ✨ Draft with AI
          </button>
          <button
            type="button"
            className={`bank-tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
            data-testid="tab-import"
          >
            📥 Batch Import
          </button>
        </div>

        {/* Tab Content */}
        <div className="bank-tab-body">
          {/* TAB 1: LIST & MANUAL ADD */}
          {activeTab === 'list' && (
            <div className="bank-list-view">
              <div className="bank-items-scroll">
                {bank.length === 0 ? (
                  <div className="bank-empty-state">
                    <p>No questions in this class bank yet.</p>
                    <span>Draft with AI or import plain-text questions to get started!</span>
                  </div>
                ) : (
                  bank.map((q, idx) => (
                    <div key={q.id || idx} className="bank-question-card">
                      <div className="bank-question-top">
                        <span className="bank-q-number">#{idx + 1}</span>
                        <p className="bank-q-text">{q.question}</p>
                        <button
                          type="button"
                          className="bank-delete-btn"
                          onClick={() => handleDeleteQuestion(idx)}
                          title="Delete question"
                        >
                          🗑️
                        </button>
                      </div>
                      <div className="bank-options-list">
                        {(q.options || []).map((opt, oIdx) => (
                          <span
                            key={oIdx}
                            className={`bank-option-pill ${q.correctIndex === oIdx ? 'correct' : ''}`}
                          >
                            {['A', 'B', 'C', 'D'][oIdx]}: {opt}
                            {q.correctIndex === oIdx && ' ✓'}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Single Question Form */}
              <form className="bank-add-form" onSubmit={handleAddSingleQuestion}>
                <h4 className="bank-form-title">+ Add Single Question</h4>
                <input
                  type="text"
                  className="bank-input"
                  placeholder="Question prompt (e.g. Which command lists files?)"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  required
                />
                <div className="bank-options-inputs">
                  {newOptions.map((opt, oIdx) => (
                    <div key={oIdx} className="bank-option-input-row">
                      <input
                        type="radio"
                        name="correctIdx"
                        checked={newCorrectIdx === oIdx}
                        onChange={() => setNewCorrectIdx(oIdx)}
                        title="Mark as correct answer"
                      />
                      <span className="bank-option-letter">{['A', 'B', 'C', 'D'][oIdx]}</span>
                      <input
                        type="text"
                        className="bank-input"
                        placeholder={`Option ${['A', 'B', 'C', 'D'][oIdx]}`}
                        value={opt}
                        onChange={(e) => {
                          const updated = [...newOptions];
                          updated[oIdx] = e.target.value;
                          setNewOptions(updated);
                        }}
                        required
                      />
                    </div>
                  ))}
                </div>
                <button type="submit" className="bank-primary-btn">
                  Add Question to Bank
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: DRAFT WITH AI */}
          {activeTab === 'ai' && (
            <div className="bank-ai-view">
              <div className="bank-ai-controls">
                <input
                  type="text"
                  className="bank-input"
                  placeholder="Topic / Lesson Objectives (e.g. React Hooks: useState, useEffect)"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  disabled={isGenerating}
                />
                <select
                  className="bank-select"
                  value={aiCount}
                  onChange={(e) => setAiCount(Number(e.target.value))}
                  disabled={isGenerating}
                >
                  <option value={3}>3 Questions</option>
                  <option value={5}>5 Questions</option>
                  <option value={10}>10 Questions</option>
                </select>
                <button
                  type="button"
                  className="bank-primary-btn"
                  onClick={handleGenerateAi}
                  disabled={isGenerating || !aiTopic.trim()}
                >
                  {isGenerating ? 'Generating...' : '✨ Generate with Gemini'}
                </button>
              </div>

              {aiError && <div className="bank-error-alert">{aiError}</div>}

              {/* Generated Preview */}
              {aiGeneratedList.length > 0 && (
                <div className="bank-ai-results">
                  <div className="bank-ai-results-header">
                    <h4>Generated Questions ({aiGeneratedList.length})</h4>
                    <button
                      type="button"
                      className="bank-primary-btn save"
                      onClick={handleSaveAiQuestions}
                    >
                      Save Selected to Bank ({selectedAiIndices.size})
                    </button>
                  </div>
                  <div className="bank-items-scroll">
                    {aiGeneratedList.map((q, idx) => {
                      const isChecked = selectedAiIndices.has(idx);
                      return (
                        <div key={idx} className="bank-question-card">
                          <div className="bank-question-top">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const next = new Set(selectedAiIndices);
                                if (e.target.checked) next.add(idx);
                                else next.delete(idx);
                                setSelectedAiIndices(next);
                              }}
                            />
                            <p className="bank-q-text">{q.question}</p>
                          </div>
                          <div className="bank-options-list">
                            {(q.options || []).map((opt, oIdx) => (
                              <span
                                key={oIdx}
                                className={`bank-option-pill ${q.correctIndex === oIdx ? 'correct' : ''}`}
                              >
                                {['A', 'B', 'C', 'D'][oIdx]}: {opt}
                                {q.correctIndex === oIdx && ' ✓'}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BATCH IMPORT */}
          {activeTab === 'import' && (
            <div className="bank-import-view">
              <div className="bank-import-help">
                <p>
                  Paste questions in standard Aiken / text format or JSON array.
                </p>
                <button type="button" className="bank-sample-link" onClick={handleLoadSample}>
                  Load Sample Questions
                </button>
              </div>

              <textarea
                className="bank-textarea"
                rows={8}
                placeholder="Question text&#10;A) Option 1&#10;B) Option 2&#10;C) Option 3&#10;D) Option 4&#10;ANSWER: B"
                value={importText}
                onChange={(e) => handlePreviewImport(e.target.value)}
              />

              {importPreview.length > 0 && (
                <div className="bank-import-footer">
                  <span className="bank-preview-count">
                    ✅ Detected {importPreview.length} valid multiple-choice questions
                  </span>
                  <button type="button" className="bank-primary-btn" onClick={handleApplyImport}>
                    Import {importPreview.length} Questions
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
