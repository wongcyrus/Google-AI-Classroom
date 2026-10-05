import { useVideoPrompts } from '../hooks/useVideoPrompts';
import BasePromptSelector from './common/BasePromptSelector';

const VideoPromptSelector = ({
  user,
  selectedPrompt,
  onSelectPrompt,
  promptText,
  onTextChange,
  readOnly = true,
}) => {
  const prompts = useVideoPrompts(user);

  return (
    <BasePromptSelector
      prompts={prompts}
      category="videos"
      user={user}
      selectedPrompt={selectedPrompt}
      onSelectPrompt={onSelectPrompt}
      promptText={promptText}
      onTextChange={onTextChange}
      readOnly={readOnly}
      filterGroupName="videoPromptFilter"
      selectAriaLabel="Select a video AI prompt template"
      textareaAriaLabel="Video prompt instructions text"
      defaultModalTitle="Video AI Prompt"
    />
  );
};

export default VideoPromptSelector;
