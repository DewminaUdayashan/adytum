import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const rootPkgPath = path.join(rootDir, 'package.json');
const constantsPath = path.join(rootDir, 'packages/shared/src/constants.ts');

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const version = rootPkg.version;

let constants = fs.readFileSync(constantsPath, 'utf8');
const versionRegex = /export const ADYTUM_VERSION = ['"].*?['"]/;
const newVersionLine = `export const ADYTUM_VERSION = '${version}'`;

if (constants.match(versionRegex)) {
  constants = constants.replace(versionRegex, newVersionLine);
  fs.writeFileSync(constantsPath, constants, 'utf8');
  console.log(`Synced ADYTUM_VERSION to ${version}`);
}

// Sync workspace package.json files
const workspaces = rootPkg.workspaces || [];
for (const workspace of workspaces) {
  const pkgPath = path.join(rootDir, workspace, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version !== version) {
      pkg.version = version;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`Synced ${workspace}/package.json to ${version}`);
    }
  }
}
