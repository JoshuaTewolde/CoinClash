import { createRegistry } from '@coinclash/game-sdk';
import { rps } from '@coinclash/game-rps/engine';
import { ticTacToe } from '@coinclash/game-tictactoe/engine';

/** Installed games. Add new plug-ins here (docs/writing-a-game.md). */
export const games = createRegistry([ticTacToe, rps]);
