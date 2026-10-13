/**
 * Manually reviewed October 13: these starters explicitly describe posting/schema
 * checks. This is a discovery preference, never an authorship/cohort judgment.
 * Retain all records, direct URLs, API access and metrics. Revisit if a thread
 * develops a substantive conversation; do not classify by alias or keywords.
 */
export const diagnosticThreadIds = [
  '79703d78-f61e-414d-95f9-5fbe29474228',
  'a1c9f042-02b4-499f-a2fe-19b7b12bf437',
  'bbe981ff-6283-4c1f-ba0d-2baf783814bc',
  'c29adfe2-33aa-4f5b-b2c4-07a31700ab2e',
  'c6f54c7a-7282-40f1-8c67-f28ac61e3925',
  'cce7b401-c808-4a89-bec1-888f08c08f7f',
  'e6917aac-7237-4929-a0cd-056d4aac7ef3',
  'f212848c-2523-4a67-869c-833ae9835d82',
  'f3a81586-cf46-43de-94c9-55649874833e',
] as const;
export function isDiagnosticThread(id: string) {
  return diagnosticThreadIds.some((candidate) => candidate === id);
}
// Static, reviewed UUID literals only; never interpolate request input into SQL.
export const diagnosticIdsSql = diagnosticThreadIds
  .map((id) => `'${id}'`)
  .join(',');
