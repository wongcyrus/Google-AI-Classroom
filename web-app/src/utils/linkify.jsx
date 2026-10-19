import React from 'react';

const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/**
 * Splits trailing sentence punctuation from a matched URL while preserving
 * balanced parentheses/brackets within the URL (e.g. Wikipedia links).
 */
function splitTrailingPunctuation(rawUrl) {
  let cleanUrl = rawUrl;
  let trailing = '';

  while (cleanUrl.length > 0) {
    const lastChar = cleanUrl[cleanUrl.length - 1];
    if (/[.,;:!?]/.test(lastChar)) {
      trailing = lastChar + trailing;
      cleanUrl = cleanUrl.slice(0, -1);
      continue;
    }
    if (lastChar === ')') {
      const openCount = (cleanUrl.match(/\(/g) || []).length;
      const closeCount = (cleanUrl.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        trailing = lastChar + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
        continue;
      }
    }
    if (lastChar === ']') {
      const openCount = (cleanUrl.match(/\[/g) || []).length;
      const closeCount = (cleanUrl.match(/\]/g) || []).length;
      if (closeCount > openCount) {
        trailing = lastChar + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { cleanUrl, trailing };
}

/**
 * Converts plain text containing URLs (http://, https://, www.) into React nodes
 * with clickable <a> links that open in a new tab (target="_blank" rel="noopener noreferrer").
 */
export function renderTextWithLinks(text, options = {}) {
  if (typeof text !== 'string' || !text) {
    return text;
  }

  const { className = 'message-link', style } = options;
  const parts = [];
  let lastIndex = 0;
  let match;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const matchStart = match.index;
    const rawUrl = match[0];

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }

    const { cleanUrl, trailing } = splitTrailingPunctuation(rawUrl);
    if (cleanUrl) {
      const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
      parts.push(
        <a
          key={`link-${matchStart}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          style={style}
          onClick={(e) => e.stopPropagation()}
        >
          {cleanUrl}
        </a>
      );
    }

    if (trailing) {
      parts.push(trailing);
    }

    lastIndex = matchStart + rawUrl.length;
  }

  if (parts.length === 0) {
    return text;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
