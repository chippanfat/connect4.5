export const BOARD_ROWS = 6;
export const BOARD_COLUMNS = 7;
export const CONNECT_LENGTH = 4;

export const COLORS = ["red", "yellow"] as const;
export type DiscColor = (typeof COLORS)[number];
export type Cell = DiscColor | null;
export type Board = Cell[][];

export interface Coordinate {
  row: number;
  column: number;
}

export type MoveFailure = "INVALID_COLUMN" | "COLUMN_FULL";

export type ApplyMoveResult =
  | { ok: false; reason: MoveFailure }
  | {
      ok: true;
      board: Board;
      row: number;
      column: number;
      color: DiscColor;
      isWin: boolean;
      isDraw: boolean;
      winningCells: Coordinate[];
    };

export function createBoard(): Board {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from<Cell>({ length: BOARD_COLUMNS }).fill(null),
  );
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function isValidBoard(board: unknown): board is Board {
  return (
    Array.isArray(board) &&
    board.length === BOARD_ROWS &&
    board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === BOARD_COLUMNS &&
        row.every((cell) => cell === null || cell === "red" || cell === "yellow"),
    )
  );
}

export function isBoardFull(board: Board): boolean {
  return board[0]?.every((cell) => cell !== null) ?? false;
}

export function getDropRow(board: Board, column: number): number | null {
  if (!Number.isInteger(column) || column < 0 || column >= BOARD_COLUMNS) {
    return null;
  }

  for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === null) {
      return row;
    }
  }

  return null;
}

function cellMatches(board: Board, row: number, column: number, color: DiscColor): boolean {
  return row >= 0 && row < BOARD_ROWS && column >= 0 && column < BOARD_COLUMNS
    ? board[row]?.[column] === color
    : false;
}

export function findWinningCells(
  board: Board,
  row: number,
  column: number,
  color: DiscColor,
): Coordinate[] {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;

  for (const [rowStep, columnStep] of directions) {
    const line: Coordinate[] = [{ row, column }];

    for (const sign of [-1, 1] as const) {
      let distance = 1;
      while (
        cellMatches(
          board,
          row + rowStep * distance * sign,
          column + columnStep * distance * sign,
          color,
        )
      ) {
        const coordinate = {
          row: row + rowStep * distance * sign,
          column: column + columnStep * distance * sign,
        };
        if (sign === -1) {
          line.unshift(coordinate);
        } else {
          line.push(coordinate);
        }
        distance += 1;
      }
    }

    if (line.length >= CONNECT_LENGTH) {
      return line;
    }
  }

  return [];
}

export function applyMove(board: Board, column: number, color: DiscColor): ApplyMoveResult {
  if (!Number.isInteger(column) || column < 0 || column >= BOARD_COLUMNS) {
    return { ok: false, reason: "INVALID_COLUMN" };
  }

  const row = getDropRow(board, column);
  if (row === null) {
    return { ok: false, reason: "COLUMN_FULL" };
  }

  const nextBoard = cloneBoard(board);
  const targetRow = nextBoard[row];
  if (!targetRow) {
    return { ok: false, reason: "INVALID_COLUMN" };
  }
  targetRow[column] = color;

  const winningCells = findWinningCells(nextBoard, row, column, color);
  const isWin = winningCells.length >= CONNECT_LENGTH;

  return {
    ok: true,
    board: nextBoard,
    row,
    column,
    color,
    isWin,
    isDraw: !isWin && isBoardFull(nextBoard),
    winningCells,
  };
}

export function otherColor(color: DiscColor): DiscColor {
  return color === "red" ? "yellow" : "red";
}
