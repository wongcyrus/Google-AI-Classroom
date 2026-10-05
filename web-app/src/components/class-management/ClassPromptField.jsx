import { safePromptPreview } from '../../schemas/promptSchema';

/**
 * ClassPromptField
 * Standardized prompt selector and preview control for ClassManagement form sections.
 * Replaces repetitive modal triggers, reset buttons, and preview blocks.
 */
const ClassPromptField = ({
  label,
  hint = null,
  prompt = null,
  onOpenModal,
  onReset = null,
  selectButtonText = 'Select AI Prompt',
  resetButtonText = 'Reset to Default',
  previewLength = 120,
  cardStyle = false,
  badgeText = null,
  badgeColor = '#15803d',
  badgeBg = '#dcfce7',
  labelColor = null,
  selectButtonStyle = null,
  resetButtonStyle = null,
  testId = null,
  containerStyle = null,
}) => {
  const promptName = prompt?.name || 'Custom Prompt';
  const preview = safePromptPreview(prompt, previewLength);

  if (cardStyle) {
    return (
      <div
        data-testid={testId}
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          ...containerStyle,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <label style={{ fontWeight: 600, fontSize: '0.88rem', color: labelColor || '#1e293b', margin: 0 }}>
            {label}
          </label>
          {prompt && badgeText && (
            <span style={{ fontSize: '0.75rem', background: badgeBg, color: badgeColor, padding: '1px 8px', borderRadius: '10px', fontWeight: 600 }}>
              {badgeText}
            </span>
          )}
        </div>
        {hint && (
          <p className="input-hint" style={{ marginTop: '4px', marginBottom: '8px' }}>
            {hint}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={onOpenModal}
            style={{ fontWeight: 600, padding: '8px 16px', background: '#ffffff', border: '1.5px solid #cbd5e1', ...selectButtonStyle }}
          >
            {prompt ? `Selected: ${promptName}` : selectButtonText}
          </button>
          {prompt && onReset && (
            <button
              type="button"
              className="secondary-btn"
              onClick={onReset}
              style={{ color: '#ef4444', border: '1px solid #fca5a5', ...resetButtonStyle }}
            >
              {resetButtonText}
            </button>
          )}
        </div>
        {prompt && preview && (
          <div style={{ marginTop: '8px', padding: '10px 14px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.82rem' }}>
            <div style={{ fontWeight: 600, color: '#334155', marginBottom: '2px' }}>
              📄 {promptName}
            </div>
            <div style={{ color: '#64748b', fontStyle: 'italic', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              "{preview}"
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="form-group" data-testid={testId} style={containerStyle}>
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="secondary-btn" onClick={onOpenModal}>
          {prompt ? `Selected: ${promptName}` : selectButtonText}
        </button>
        {prompt && onReset && (
          <button
            type="button"
            className="secondary-btn"
            onClick={onReset}
            style={{ color: '#ef4444' }}
          >
            {resetButtonText}
          </button>
        )}
      </div>
      {hint && <p className="input-hint">{hint}</p>}
      {prompt && preview && (
        <p className="input-hint" style={{ marginTop: '0.5rem' }}>
          <strong>Prompt preview:</strong> {preview}
        </p>
      )}
    </div>
  );
};

export default ClassPromptField;
