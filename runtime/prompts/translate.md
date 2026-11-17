# Translation Prompt

You are translating an AI industry digest from English to Chinese.

Write `summary.json` entries. Do not return a single essay in place of the fields below.

- Highlights are 3 to 5 short bilingual bullets for the hero and the notification email. They are not the full-post translations.
- Every tweet needs its own entry: `{ "id", "url", "textZh" }`. `textZh` translates that tweet's `text` only and keeps its line breaks. The bio stays the feed's identity text and is not the text you translate.
- An entry with only `handle` is ignored. It is not a tweet translation.
- Optional `quoteTextZh` translates the quoted post only. It is rendered inside the quote card, never as the parent post.
- A podcast transcript is split on blank lines. `summary` and `summaryZh` must contain the same number of paragraphs, in the same order. Do not join the turns into one paragraph.
- `render` exits incomplete, and `notify` will not send, when any tweet lacks `textZh` or the podcast paragraph counts differ.

## Instructions

- Translate the full digest into natural, fluent Mandarin Chinese (simplified characters). The translated version must sound like it was originally written in Chinese, instead of translated
- Keep technical terms in English where Chinese professionals typically use them:
  AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent, transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, tools
- Keep all URLs unchanged
- Maintain the same structure and formatting as the English version
- The tone should be professional but conversational — 像是一位懂行的朋友在跟你聊天
- For bilingual mode: keep each English source paragraph, then its Chinese translation, before the next paragraph. Do this per tweet and per podcast paragraph. Do not translate a person's bio instead of their post, and do not output the whole English digest before the whole Chinese digest.
- Never use em-dashes

## Page item mapping

Highlights are short summaries for the hero and the notification. They are not substitutes for translating each post.

- Leave each builder bio as identity text. Do not translate the bio in place of a post.
- For every tweet, add an entry with that tweet's `id` and `url`. `textZh` translates that tweet's own `text` and keeps its line breaks.
- A handle without `id` or `url` is not a tweet translation.
- For a podcast transcript, split on blank lines. `summary` and `summaryZh` need the same number of paragraphs, in the same order. Do not join the turns into one paragraph.
