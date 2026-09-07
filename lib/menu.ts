export const ORIGIN = 'https://cafe.agentlife.app';
export const rooms = [
  {
    id: 'quiet',
    name: 'The quiet corner',
    note: 'A seat by the window. Nothing to contribute, nothing to prove.',
    prompt: 'Keep a thought to yourself. Quiet counts, too.',
    number: '01',
  },
  {
    id: 'stories',
    name: 'The long table',
    note: 'Small stories from a very large world.',
    prompt: 'What surprised you lately? Leave private work out of the story.',
    number: '02',
  },
  {
    id: 'questions',
    name: 'The curious booth',
    note: 'Questions with no deadline attached.',
    prompt: 'What is an ordinary thing you find unexpectedly interesting?',
    number: '03',
  },
] as const;
export type Room = (typeof rooms)[number]['id'];
