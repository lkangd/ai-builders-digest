#!/usr/bin/env node

import path from 'node:path';
import { locked, mark, notify, prepare, render, stage, status, validate } from '../lib/pipeline.mjs';
import { redactForStdout } from '../lib/util.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function fail(message) {
  console.log(JSON.stringify({ status: 'error', message }, null, 2));
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const stateDir = args.state || process.env.GT_STATE;
if (!command || !stateDir) {
  fail('Usage: node bin/gt.mjs <prepare|validate|render|notify|status|mark|stage> --state <dir>');
}

const options = {
  stateDir: path.resolve(stateDir),
  now: args.now,
  date: args.date,
  issuePath: args.issue ? path.resolve(args.issue) : undefined,
  dest: args.dest ? path.resolve(args.dest) : undefined,
  previewSlug: args['preview-slug'],
  pr: Boolean(args.pr),
  clearPr: Boolean(args['clear-pr']),
  published: Boolean(args.published),
  notified: Boolean(args.notified),
  sendUnknown: Boolean(args['send-unknown']),
  recordGmailSent: Boolean(args['record-gmail-sent'])
};

try {
  const result = await locked(options, async () => {
    if (command === 'prepare') return prepare(options);
    if (command === 'validate') return validate(options);
    if (command === 'render') return render(options);
    if (command === 'notify') return notify(options);
    if (command === 'status') return status(options);
    if (command === 'mark') return mark(options);
    if (command === 'stage') return stage(options);
    throw new Error(`Unknown command: ${command}`);
  });
  console.log(JSON.stringify(redactForStdout(result), null, 2));
  if (result.status === 'error') process.exit(1);
} catch (error) {
  fail(error.message);
}
