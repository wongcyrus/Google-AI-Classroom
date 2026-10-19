import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderTextWithLinks } from './linkify';

describe('renderTextWithLinks utility', () => {
  it('returns non-string or empty inputs unchanged', () => {
    expect(renderTextWithLinks(null)).toBeNull();
    expect(renderTextWithLinks(undefined)).toBeUndefined();
    expect(renderTextWithLinks('')).toBe('');
    expect(renderTextWithLinks('Plain message without links')).toBe('Plain message without links');
  });

  it('converts http, https, and www URLs into clickable _blank links and strips trailing punctuation', () => {
    const text = 'Check https://docs.google.com/forms/d/123, (http://example.org/test) and www.vtc.edu.hk!';
    render(<div>{renderTextWithLinks(text)}</div>);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);

    expect(links[0]).toHaveTextContent('https://docs.google.com/forms/d/123');
    expect(links[0]).toHaveAttribute('href', 'https://docs.google.com/forms/d/123');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');

    expect(links[1]).toHaveTextContent('http://example.org/test');
    expect(links[1]).toHaveAttribute('href', 'http://example.org/test');
    expect(links[1]).toHaveAttribute('target', '_blank');

    expect(links[2]).toHaveTextContent('www.vtc.edu.hk');
    expect(links[2]).toHaveAttribute('href', 'https://www.vtc.edu.hk');
    expect(links[2]).toHaveAttribute('target', '_blank');
  });

  it('preserves balanced parentheses inside URLs', () => {
    const text = 'Read https://en.wikipedia.org/wiki/Python_(programming_language).';
    render(<div>{renderTextWithLinks(text)}</div>);

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('https://en.wikipedia.org/wiki/Python_(programming_language)');
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Python_(programming_language)');
  });
});
