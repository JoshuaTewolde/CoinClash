import { createRegistry } from '@coinclash/game-sdk';
import { connect4 } from '@coinclash/game-connect4/engine';
import { pool } from '@coinclash/game-pool/engine';
import { rps } from '@coinclash/game-rps/engine';
import { ticTacToe } from '@coinclash/game-tictactoe/engine';
import { trivia } from '@coinclash/game-trivia/engine';

/** Installed games. Add new plug-ins here (docs/writing-a-game.md). */
export const games = createRegistry([ticTacToe, connect4, rps, trivia, pool]);
