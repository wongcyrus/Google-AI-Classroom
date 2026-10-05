import { usePrompts } from '../hooks/usePrompts';
import BasePromptSelector from './common/BasePromptSelector';

const ImagePromptSelector = ({
  user,
  selectedPrompt,
  onSelectPrompt,
  promptText,
  onTextChange,
  applyToFilter = 'Per Image',
  readOnly = true,
}) => {
  const { prompts } = usePrompts(applyToFilter);
  const isBingo = applyToFilter === 'Classroom Bingo Questions' || applyToFilter === 'bingo';

  return (
    <BasePromptSelector
      prompts={prompts}
      category="images"
      user={user}
      selectedPrompt={selectedPrompt}
      onSelectPrompt={onSelectPrompt}
      promptText={promptText}
      onTextChange={onTextChange}
      applyToFilter={applyToFilter}
      readOnly={readOnly}
      filterGroupName="imagePromptFilter"
      selectAriaLabel={isBingo ? 'Select a Classroom Bingo Question prompt' : 'Select an image invigilation AI prompt'}
      textareaAriaLabel={isBingo ? 'Classroom Bingo Question prompt text' : 'Image invigilation AI prompt text'}
      defaultModalTitle={isBingo ? 'Bingo Question Prompt' : 'Vision AI Invigilation Prompt'}
    />
  );
};

export default ImagePromptSelector;
