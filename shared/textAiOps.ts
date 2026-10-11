/**
 * Ready-made text jobs for the "AI text" node. `{option}` is replaced by the option field.
 * Pure data, so the card search index (shared/cardSearch.ts) can build deep entries
 * ("AI text · Translate", …) straight from this registry instead of a hand list.
 */
export const TEXT_AI_OPERATIONS = [
	{ id: 'summarize', label: 'Summarize', option: 'length, e.g. 3 sentences', prompt: 'Summarize the input in {option}. Keep the key facts.' },
	{ id: 'bullets', label: 'Bullet points', option: 'max points, e.g. 5', prompt: 'Turn the input into at most {option} short bullet points.' },
	{ id: 'translate', label: 'Translate', option: 'target language, e.g. Chinese', prompt: 'Translate the input into {option}. Return only the translation.' },
	{ id: 'rewrite', label: 'Rewrite / change tone', option: 'tone, e.g. friendly and short', prompt: 'Rewrite the input so it is {option}. Keep the meaning.' },
	{ id: 'fix', label: 'Fix grammar & spelling', option: '', prompt: 'Fix grammar, spelling and punctuation. Return only the corrected text.' },
	{ id: 'simplify', label: 'Simplify (plain English)', option: 'reader, e.g. a 12-year-old', prompt: 'Rewrite the input in simple words for {option}. Short sentences.' },
	{ id: 'keywords', label: 'Keywords / tags', option: 'how many, e.g. 8', prompt: 'List {option} keywords for the input, comma separated, nothing else.' },
	{ id: 'title', label: 'Title / headline', option: 'style, e.g. catchy', prompt: 'Write one {option} title for the input. Return only the title.' },
	{ id: 'json', label: 'Extract to JSON', option: 'fields, e.g. name, email, date', prompt: 'Extract these fields from the input as a JSON object: {option}. Return only JSON.' },
	{ id: 'classify', label: 'Classify', option: 'labels, e.g. bug, feature, question', prompt: 'Classify the input as one of: {option}. Return only the label.' },
	{ id: 'questions', label: 'Questions & answers', option: 'how many, e.g. 5', prompt: 'Write {option} questions with short answers about the input.' },
	{ id: 'explain', label: 'Explain', option: 'audience, e.g. a beginner', prompt: 'Explain the input to {option}.' },
	{ id: 'prompt', label: 'Image prompt', option: 'style, e.g. watercolor', prompt: 'Write one detailed text-to-image prompt ({option} style) that shows the input. Return only the prompt.' },
	{ id: 'custom', label: 'Custom instruction', option: '', prompt: '' },
] as const
