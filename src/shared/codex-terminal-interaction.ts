export interface ParsedTerminalInteractionInput {
  commands: string[];
  inputBuffer: string;
}

export function getTerminalInteractionBufferKey(conversationId: string, itemId: string): string {
  return `${conversationId}:${itemId}`;
}

export function parseTerminalInteractionInput(
  existingInputBuffer: string,
  stdin: string,
): ParsedTerminalInteractionInput {
  const commands: string[] = [];
  let inputBuffer = existingInputBuffer;

  for (const character of stdin) {
    if (character === "\r" || character === "\n") {
      const command = inputBuffer.trim();
      if (command.length > 0) commands.push(command);
      inputBuffer = "";
      continue;
    }

    if (character === "\u0003") {
      inputBuffer = "";
      continue;
    }

    if (character === "\b" || character === "\u007f") {
      inputBuffer = inputBuffer.slice(0, -1);
      continue;
    }

    inputBuffer += character;
  }

  return { commands, inputBuffer };
}
