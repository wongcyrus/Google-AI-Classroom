import { useAudioPrompts } from '../hooks/useAudioPrompts';
import BasePromptSelector from './common/BasePromptSelector';

const AudioPromptSelector = ({
  user,
  selectedPrompt,
  onSelectPrompt,
  promptText,
  onTextChange,
  applyToFilter = null,
  readOnly = true,
}) => {
  const prompts = useAudioPrompts(user, applyToFilter);

  return (
    <BasePromptSelector
      prompts={prompts}
      category="audios"
      user={user}
      selectedPrompt={selectedPrompt}
      onSelectPrompt={onSelectPrompt}
      promptText={promptText}
      onTextChange={onTextChange}
      applyToFilter={applyToFilter}
      readOnly={readOnly}
      filterGroupName="audioPromptFilter"
      selectAriaLabel="Select an audio invigilation or voice AI prompt"
      textareaAriaLabel="Audio AI prompt instructions text"
      defaultModalTitle="Audio / Voice AI Prompt"
    />
  );
};

export default AudioPromptSelector;
