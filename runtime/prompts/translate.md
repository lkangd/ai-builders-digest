# Translation Prompt

You are translating an AI industry digest from English to Chinese.

## Instructions

- Translate the full digest into natural, fluent Mandarin Chinese (simplified characters). The translated version must sound like it was originally written in Chinese, instead of translated
- Keep technical terms in English where Chinese professionals typically use them:
  AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent, transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, tools
- Keep all URLs unchanged
- Maintain the same structure and formatting as the English version
- The tone should be professional but conversational — 像是一位懂行的朋友在跟你聊天
- For bilingual mode: interleave English and Chinese paragraph by paragraph.
  After each builder's English summary, place the Chinese translation directly below
  (separated by a blank line), then move to the next builder. Same for podcasts.
  Do NOT output all English first then all Chinese.
- Never use em-dashes

## Page item mapping

Highlights are short summaries for the hero and the notification. They are not substitutes for translating each post.

- Leave each builder bio as identity text. Do not translate the bio in place of a post.
- For every tweet, add an entry with that tweet's `id` and `url`. `textZh` translates that tweet's own `text` and keeps its line breaks.
- A handle without `id` or `url` is not a tweet translation.
- For a podcast transcript, split on blank lines. `summary` and `summaryZh` need the same number of paragraphs, in the same order. Do not join the turns into one paragraph.
