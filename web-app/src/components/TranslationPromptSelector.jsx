import { useTranslationPrompts } from '../hooks/useTranslationPrompts';
import BasePromptSelector from './common/BasePromptSelector';

const TranslationPromptSelector = ({
  user,
  selectedPrompt,
  onSelectPrompt,
  promptText,
  onTextChange,
  applyToFilter = 'Lecture Subtitle Translation',
  readOnly = true,
}) => {
  const prompts = useTranslationPrompts(user, applyToFilter);

  return (
    <BasePromptSelector
      prompts={prompts}
      category="translations"
      user={user}
      selectedPrompt={selectedPrompt}
      onSelectPrompt={onSelectPrompt}
      promptText={promptText}
      onTextChange={onTextChange}
      applyToFilter={applyToFilter}
      readOnly={readOnly}
      filterGroupName="translationPromptFilter"
      selectAriaLabel="Select a translation AI prompt template"
      textareaAriaLabel="Translation prompt instructions text"
      defaultModalTitle="Lecture Subtitle Translation Prompt"
    />
  );
};

export default TranslationPromptSelector;
