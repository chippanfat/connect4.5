import { describe, expect, it } from "vitest";

import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  applyMove,
  createBoard,
  findWinningCells,
  getDropRow,
  isBoardFull,
  isValidBoard,
  type Board,
  type DiscColor,
} from "./index";

function play(columns: number[], first: DiscColor = "red"): Board {
  let board = createBoard();
  let color = first;
  for (const column of columns) {
    const result = applyMove(board, column, color);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    board = result.board;
    color = color === "red" ? "yellow" : "red";
  }
  return board;
}

describe("game engine", () => {
  it("creates a valid empty 6 by 7 board", () => {
    const board = createBoard();
    expect(board).toHaveLength(BOARD_ROWS);
    expect(board.every((row) => row.length === BOARD_COLUMNS)).toBe(true);
    expect(isValidBoard(board)).toBe(true);
  });

  it("drops discs to the lowest available row without mutating the input", () => {
    const board = createBoard();
    const first = applyMove(board, 3, "red");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.row).toBe(5);
    expect(board[5]?.[3]).toBeNull();

    const second = applyMove(first.board, 3, "yellow");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.row).toBe(4);
    expect(getDropRow(second.board, 3)).toBe(3);
  });

  it("rejects invalid and full columns", () => {
    expect(applyMove(createBoard(), -1, "red")).toEqual({
      ok: false,
      reason: "INVALID_COLUMN",
    });

    let board = createBoard();
    for (let index = 0; index < BOARD_ROWS; index += 1) {
      const result = applyMove(board, 0, index % 2 === 0 ? "red" : "yellow");
      if (!result.ok) throw new Error(result.reason);
      board = result.board;
    }
    expect(applyMove(board, 0, "red")).toEqual({ ok: false, reason: "COLUMN_FULL" });
  });

  it.each([
    {
      name: "horizontal",
      board: play([0, 0, 1, 1, 2, 2, 3]),
      row: 5,
      column: 3,
    },
    {
      name: "vertical",
      board: play([0, 1, 0, 1, 0, 1, 0]),
      row: 2,
      column: 0,
    },
    {
      name: "rising diagonal",
      board: play([0, 1, 1, 2, 3, 2, 2, 3, 4, 3, 3]),
      row: 2,
      column: 3,
    },
    {
      name: "falling diagonal",
      board: play([3, 2, 2, 1, 0, 1, 1, 0, 4, 0, 0]),
      row: 2,
      column: 0,
    },
  ])("detects a $name win", ({ board, row, column }) => {
    expect(findWinningCells(board, row, column, "red")).toHaveLength(4);
  });

  it("recognizes a full board", () => {
    const board = createBoard().map((row, rowIndex) =>
      row.map((_, columnIndex) =>
        (rowIndex + Math.floor(columnIndex / 2)) % 2 ? "red" : "yellow",
      ),
    ) satisfies Board;
    expect(isBoardFull(board)).toBe(true);
  });

  it("preserves gravity and disc counts through deterministic random play", () => {
    let seed = 0x5f3759df;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let game = 0; game < 100; game += 1) {
      let board = createBoard();
      let moves = 0;
      for (let turn = 0; turn < BOARD_ROWS * BOARD_COLUMNS; turn += 1) {
        const openColumns = Array.from({ length: BOARD_COLUMNS }, (_, column) => column).filter(
          (column) => board[0]?.[column] === null,
        );
        if (openColumns.length === 0) break;
        const column = openColumns[Math.floor(random() * openColumns.length)];
        if (column === undefined) break;
        const result = applyMove(board, column, turn % 2 === 0 ? "red" : "yellow");
        if (!result.ok) throw new Error(result.reason);
        board = result.board;
        moves += 1;
        if (result.isWin) break;
      }

      const occupied = board.flat().filter(Boolean).length;
      expect(occupied).toBe(moves);
      for (let column = 0; column < BOARD_COLUMNS; column += 1) {
        let foundDisc = false;
        for (let row = 0; row < BOARD_ROWS; row += 1) {
          const cell = board[row]?.[column];
          if (cell !== null) foundDisc = true;
          if (foundDisc) expect(cell).not.toBeNull();
        }
      }
    }
  });
});
