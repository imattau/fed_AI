import * as readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export const ask = (question: string, defaultValue?: string): Promise<string> => {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
};

export const askSecret = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    // Basic implementation: formatted as a question but input is visible.
    // Hiding input in node native readline is tricky without muting output stream.
    // For simplicity in this CLI context, we will accept visible input or minimal masking if possible.
    // Given the constraints, we'll just warn the user.
    console.log(`${question} (input will be visible)`);
    rl.question('> ', (answer) => {
      resolve(answer.trim());
    });
  });
};

export const choose = async (question: string, options: string[]): Promise<string> => {
  console.log(question);
  options.forEach((opt, idx) => {
    console.log(`  ${idx + 1}. ${opt}`);
  });

  while (true) {
    const answer = await ask('Select an option (number)');
    const idx = Number.parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx];
    }
    console.log('Invalid selection. Please try again.');
  }
};

export const closeInteractive = () => {
  rl.close();
};
