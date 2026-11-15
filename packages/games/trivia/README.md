# @coinclash/game-trivia

Head-to-head multiple-choice trivia. Both players answer the same question at once
(`turnModel: 'simultaneous'`), 20 seconds per question.

- **Main round:** 5 questions. Score = number answered correctly.
- **Sudden death:** if tied after 5, up to 3 extra questions. The first question one player gets
  right while the other misses wins. Still tied after 3 extra questions: draw.
- **Timeouts:** a player who doesn't answer in time gets the question wrong; the game moves on.
- **Hidden info:** `viewFor` never shows the correct answer or the opponent's choice for the open
  question, only whether they have answered. Finished questions show everything.
- The match seed picks the 8 questions (5 + 3 sudden death) and shuffles each question's options.

## Question bank

`src/questions.ts` is a bundled bank of 177 four-option questions across General, Science,
Geography, History, Sports, Entertainment and Bitcoin basics. All questions are **original content
written for CoinClash**, not copied from any trivia database. It ships with the engine: no network
calls. Tests check every question has four unique options, a valid answer and a unique prompt.

To add questions, append `q(category, prompt, correct, wrong1, wrong2, wrong3)` entries. Keep them
family-friendly, unambiguous and stable over time (avoid "current record holder" style facts).
