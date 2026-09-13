import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BingoQuestionBankModal, { parseTextQuestions } from './BingoQuestionBankModal';
import { httpsCallable } from 'firebase/functions';

// Mock firebase/functions
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  functions: {},
}));

describe('BingoQuestionBankModal & parseTextQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseTextQuestions', () => {
    it('parses valid Aiken format plain text with ANSWER: B', () => {
      const text = `Which command lists containers?
A) docker run
B) docker ps
C) docker stop
D) docker build
ANSWER: B`;

      const result = parseTextQuestions(text);
      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('Which command lists containers?');
      expect(result[0].options).toEqual(['docker run', 'docker ps', 'docker stop', 'docker build']);
      expect(result[0].correctIndex).toBe(1);
    });

    it('parses multiple Aiken questions and handles alternative punctuation (dot or paren)', () => {
      const text = `What is Git?
A. Version control
B. Programming language
C. Operating system
D. Database
ANSWER: A

What is DNS?
A) Domain Name System
B) Data Network Server
C) Digital Node Standard
D) Direct Network Socket
ANSWER: a`;

      const result = parseTextQuestions(text);
      expect(result).toHaveLength(2);
      expect(result[0].question).toBe('What is Git?');
      expect(result[0].correctIndex).toBe(0);
      expect(result[1].question).toBe('What is DNS?');
      expect(result[1].correctIndex).toBe(0);
    });

    it('parses JSON formatted questions correctly', () => {
      const jsonText = JSON.stringify([
        {
          question: 'What is port 443?',
          options: ['HTTP', 'HTTPS', 'SSH', 'FTP'],
          correctIndex: 1,
        },
      ]);

      const result = parseTextQuestions(jsonText);
      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('What is port 443?');
      expect(result[0].correctIndex).toBe(1);
    });

    it('returns empty array on invalid or incomplete text', () => {
      expect(parseTextQuestions('')).toEqual([]);
      expect(parseTextQuestions('Too short')).toEqual([]);
      expect(parseTextQuestions('Q only\nA) Opt1\nB) Opt2')).toEqual([]);
    });

    it('gracefully handles malformed JSON without crashing', () => {
      const malformedJson = '[{"question": "Broken json without ending quote}';
      const result = parseTextQuestions(malformedJson);
      expect(result).toEqual([]);
    });
  });

  describe('BingoQuestionBankModal UI', () => {
    const initialBank = [
      {
        id: 'q1',
        question: 'What is Node.js?',
        options: ['Runtime', 'Framework', 'Database', 'Browser'],
        correctIndex: 0,
      },
    ];

    it('returns null when isOpen is false', () => {
      const { container } = render(
        <BingoQuestionBankModal
          isOpen={false}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={vi.fn()}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders empty state when question bank is empty', () => {
      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={[]}
          onSaveBank={vi.fn()}
        />
      );

      expect(screen.getByText('No questions in this class bank yet.')).toBeInTheDocument();
      expect(screen.getByText(/Draft with AI or import plain-text questions/)).toBeInTheDocument();
    });

    it('renders list of questions in the bank and calls onClose when close button clicked', () => {
      const mockClose = vi.fn();
      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={mockClose}
          questionBank={initialBank}
          onSaveBank={vi.fn()}
        />
      );

      expect(screen.getByText('📚 Bingo Predefined Question Bank')).toBeInTheDocument();
      expect(screen.getByText('What is Node.js?')).toBeInTheDocument();
      expect(screen.getByText(/Runtime/)).toBeInTheDocument();

      const closeBtn = screen.getByLabelText('Close');
      fireEvent.click(closeBtn);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('deletes an existing question from Question Pool', () => {
      const mockSave = vi.fn();
      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={mockSave}
        />
      );

      const deleteBtn = screen.getByTitle('Delete question');
      fireEvent.click(deleteBtn);

      expect(mockSave).toHaveBeenCalledWith([]);
    });

    it('adds a single question manually via form in list tab', () => {
      const mockSave = vi.fn();
      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={mockSave}
        />
      );

      const promptInput = screen.getByPlaceholderText(/Question prompt/);
      fireEvent.change(promptInput, { target: { value: 'What is CSS?' } });

      const optA = screen.getByPlaceholderText('Option A');
      const optB = screen.getByPlaceholderText('Option B');
      const optC = screen.getByPlaceholderText('Option C');
      const optD = screen.getByPlaceholderText('Option D');

      fireEvent.change(optA, { target: { value: 'Scripting' } });
      fireEvent.change(optB, { target: { value: 'Styles' } });
      fireEvent.change(optC, { target: { value: 'Database' } });
      fireEvent.change(optD, { target: { value: 'Protocol' } });

      // Select option B as correct
      const radioOptions = screen.getAllByTitle('Mark as correct answer');
      fireEvent.click(radioOptions[1]);

      const submitBtn = screen.getByText('Add Question to Bank');
      fireEvent.click(submitBtn);

      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ question: 'What is Node.js?' }),
          expect.objectContaining({
            question: 'What is CSS?',
            options: ['Scripting', 'Styles', 'Database', 'Protocol'],
            correctIndex: 1,
          }),
        ])
      );
    });

    it('switches to Batch Import tab and applies imported questions', async () => {
      const mockSave = vi.fn();
      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={mockSave}
        />
      );

      const importTab = screen.getByTestId('tab-import');
      fireEvent.click(importTab);

      // Click Load Sample
      const loadSampleBtn = screen.getByText('Load Sample Questions');
      fireEvent.click(loadSampleBtn);

      expect(screen.getByText(/Detected 3 valid multiple-choice questions/)).toBeInTheDocument();

      const applyBtn = screen.getByText(/Import 3 Questions/);
      fireEvent.click(applyBtn);

      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ question: 'What is Node.js?' }),
          expect.objectContaining({ question: expect.stringContaining('Docker') }),
        ])
      );
    });

    it('handles AI question generation and saving selected generated questions', async () => {
      const mockSave = vi.fn();
      const mockCallable = vi.fn().mockResolvedValue({
        data: {
          questions: [
            {
              question: 'What is React JSX?',
              options: ['Syntax extension', 'Database query', 'Styling sheet', 'Server protocol'],
              correctIndex: 0,
            },
            {
              question: 'What is useEffect for?',
              options: ['Side effects', 'State only', 'Routing', 'Bundling'],
              correctIndex: 0,
            },
          ],
        },
      });
      httpsCallable.mockReturnValue(mockCallable);

      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={mockSave}
        />
      );

      // Switch to AI tab
      const aiTab = screen.getByTestId('tab-ai');
      fireEvent.click(aiTab);

      const topicInput = screen.getByPlaceholderText(/Topic \/ Lesson Objectives/);
      fireEvent.change(topicInput, { target: { value: 'React Basics' } });

      const countSelect = screen.getByRole('combobox');
      fireEvent.change(countSelect, { target: { value: '5' } });

      const generateBtn = screen.getByText('✨ Generate with Gemini');
      await act(async () => {
        fireEvent.click(generateBtn);
      });

      expect(mockCallable).toHaveBeenCalledWith({
        topic: 'React Basics',
        count: 5,
      });

      expect(screen.getByText('Generated Questions (2)')).toBeInTheDocument();
      expect(screen.getByText('What is React JSX?')).toBeInTheDocument();
      expect(screen.getByText('What is useEffect for?')).toBeInTheDocument();

      // Toggle off the second question checkbox
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]);

      const saveAiBtn = screen.getByText(/Save Selected to Bank \(1\)/);
      fireEvent.click(saveAiBtn);

      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ question: 'What is Node.js?' }),
          expect.objectContaining({ question: 'What is React JSX?' }),
        ])
      );
    });

    it('displays error alert when AI generation fails', async () => {
      const mockCallable = vi.fn().mockRejectedValue(new Error('Vertex AI rate limit exceeded'));
      httpsCallable.mockReturnValue(mockCallable);

      render(
        <BingoQuestionBankModal
          isOpen={true}
          onClose={vi.fn()}
          questionBank={initialBank}
          onSaveBank={vi.fn()}
        />
      );

      const aiTab = screen.getByTestId('tab-ai');
      fireEvent.click(aiTab);

      const topicInput = screen.getByPlaceholderText(/Topic \/ Lesson Objectives/);
      fireEvent.change(topicInput, { target: { value: 'Advanced Cloud' } });

      const generateBtn = screen.getByText('✨ Generate with Gemini');
      await act(async () => {
        fireEvent.click(generateBtn);
      });

      expect(screen.getByText('Vertex AI rate limit exceeded')).toBeInTheDocument();
    });
  });
});
