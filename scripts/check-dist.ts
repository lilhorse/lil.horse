import { checkDist } from '../src/lib/dist-check';

const issues = await checkDist('dist');
for (const issue of issues) console.error(`✗ ${issue.file}: ${issue.message}`);
if (issues.length > 0) {
  console.error(`\n${issues.length} problem(s) found in dist/`);
  process.exit(1);
}
console.log('dist/ passed all checks');
