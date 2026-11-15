import { createRegistry } from '@coinclash/game-sdk';
import { ticTacToe } from '@coinclash/game-tictactoe/engine';
import { trivia } from '@coinclash/game-trivia/engine';

/** Installed games. Add new plug-ins here (docs/writing-a-game.md). */
export const games = createRegistry([ticTacToe, trivia]);
