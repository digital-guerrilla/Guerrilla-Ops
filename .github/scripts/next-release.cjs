const { execFileSync } = require('node:child_process');

function nextReleaseTag(tags) {
  const versions = tags.split(/\r?\n/)
    .map(tag => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag))
    .filter(Boolean)
    .map(match => match.slice(1).map(BigInt));
  if (!versions.length) return 'v1.1.1';
  versions.sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
  });
  const [major, minor, patch] = versions[versions.length - 1];
  return `v${major}.${minor}.${patch + 1n}`;
}

if (require.main === module) {
  console.log(nextReleaseTag(execFileSync('git', ['tag', '--list'], { encoding: 'utf8' })));
}

module.exports = { nextReleaseTag };
